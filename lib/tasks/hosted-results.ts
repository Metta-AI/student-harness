import {db,studentToken,experimentByXp} from '../db';
import {reconcileGame} from '../reconcile-games';
import {terminalGame} from './model';
import {runtimeOwner} from './runtime-owner';

type Pending={id:string;student_id:string;checkpoint:Record<string,unknown>;next_check_at:string;runtime_id?:string|null};
/** Existing hosted requests only. Owners share a compare-and-set polling cursor;
 * no deployment observes another world's task or acquires its account token. */
export async function reconcileTaskHostedResults(){
 const owner=runtimeOwner(),now=new Date().toISOString();
 const read=(legacySchema=false)=>{
  let query=db().from('agent_tasks').select(legacySchema?'id,student_id,checkpoint,next_check_at':'id,student_id,checkpoint,next_check_at,runtime_id')
   .eq('status','waiting').lte('next_check_at',now).gt('deadline_at',now);
  if(!legacySchema)query=owner?query.eq('runtime_id',owner):query.is('runtime_id',null);
  return query.order('next_check_at').limit(50);
 };
 let legacySchema=false,pending=await read();
 // During staged rollout the unconfigured worker can still serve the old
 // schema. Missing RPCs, credentials, and unrelated SQL errors never downgrade.
 if(!owner&&pending.error?.code==='42703'&&/\bruntime_id\b/.test(pending.error.message)){
  legacySchema=true;pending=await read(true);
 }
 if(pending.error)throw Error('Hosted task results could not read owned polling work');
 const results=await Promise.allSettled((pending.data as unknown as Pending[]).map(async task=>{
  if((task.runtime_id??null)!==owner||typeof task.id!=='string'||typeof task.student_id!=='string'||!task.student_id||
   typeof task.next_check_at!=='string'||!Number.isFinite(Date.parse(task.next_check_at)))throw Error('Hosted result ownership unavailable');
  // Claim the original due cursor. A concurrent scheduler or a Stop wins by
  // changing the cursor/status; losers cannot load credentials or poll a game.
  let update=db().from('agent_tasks').update({next_check_at:new Date(Date.now()+60000).toISOString()})
   .eq('id',task.id).eq('student_id',task.student_id).eq('status','waiting').eq('next_check_at',task.next_check_at).gt('deadline_at',now);
  if(!legacySchema)update=owner?update.eq('runtime_id',owner):update.is('runtime_id',null);
  const touched=await update.select('id').maybeSingle();
  if(touched.error)throw Error('Hosted task polling cursor unavailable');
  if(!touched.data)return;
  const xp=task.checkpoint?.xp_request_id;
  if(typeof xp!=='string'||!xp)return;
  const experiment=await experimentByXp(task.student_id,xp);
  if(!experiment||terminalGame(experiment.status))return;
  if(experiment.student_id!==task.student_id||experiment.xp_request_id!==xp)throw Error('Hosted experiment ownership unavailable');
  await reconcileGame(experiment,await studentToken(task.student_id));
 }));
 const failed=results.filter(result=>result.status==='rejected').length;
 if(failed)throw Error(`Hosted results could not reconcile ${failed} owned tasks; their polling cursors remain bounded`);
}
