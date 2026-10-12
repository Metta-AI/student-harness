import {Client} from 'eve/client';
import {db,studentToken} from '../db';
import {cookieName,seal} from '../student-session';
import {rpc,taskById} from './store';
import {runtimeRecoveryTarget} from './runtime-target';
import {runtimeOwner} from './runtime-owner';
type Stop={id:string;task_id:string;student_id:string;session_id:string;generation:number;token:string;runtime_id?:string|null};
/** SQL already fences effects. This requests cooperative cancellation to release
 * old model/tool work; accepted does not mean an in-flight external action stopped. */
export async function dispatchRuntimeStops(){
 const owner=runtimeOwner();
 const target=runtimeRecoveryTarget();
 const controls=await rpc<Stop[]>(owner?'task_claim_runtime_stops_scoped':'task_claim_runtime_stops',owner?{p_runtime:owner}:undefined);
 const results=await Promise.allSettled(controls.map(async control=>{
  if(owner&&(control.runtime_id!==owner||!Number.isSafeInteger(control.generation)||control.generation<0||
   ![control.id,control.task_id,control.token].every(value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))||
   typeof control.student_id!=='string'||!control.student_id||typeof control.session_id!=='string'||!control.session_id))throw Error('Runtime cancellation ownership unavailable');
  const finish=(error:string|null)=>rpc(owner?'task_finish_runtime_stop_scoped':'task_finish_runtime_stop',{...(owner?{p_runtime:owner}:{}),p_id:control.id,p_token:control.token,p_error:error});
  try{
   const task=await taskById(control.task_id,control.student_id);
   if(!task||task.generation<=control.generation||(owner&&task.runtime_id!==owner))throw Error('Runtime stop has no superseded owned task');
   let query=db().from('agent_task_executions').select(owner?'session_id,generation,runtime_id':'session_id').eq('task_id',task.id).eq('session_id',control.session_id);
   query=owner?query.eq('generation',control.generation).eq('runtime_id',owner):query.lte('generation',control.generation);
   const history=await query.maybeSingle();
   if(history.error||!history.data)throw Error('Runtime stop execution ownership unavailable');
   const execution=history.data as unknown as {runtime_id?:unknown;generation?:unknown;session_id?:unknown};
   if(owner&&(execution.runtime_id!==owner||execution.generation!==control.generation||execution.session_id!==control.session_id))throw Error('Runtime stop execution ownership unavailable');
   const {data:student,error}=await db().from('students').select('email').eq('subject_id',control.student_id).single();
   if(error||!student)throw Error('Runtime stop account unavailable');
   const client=new Client({...target,headers:{...target.headers,Cookie:`${cookieName}=${seal({subjectId:control.student_id,email:student.email,token:await studentToken(control.student_id)})}`}});
   const result=await client.sessions.attach(control.session_id).cancel({tasks:true,signal:AbortSignal.timeout(8000)});
   if(!['accepted','no_active_turn'].includes(result.status))throw Error('Runtime stop was not acknowledged');
   await finish(null);
  }catch{
   // Observation/transport failure is not task completion. Keep a redacted retry.
   await finish('Runtime cancellation could not be acknowledged; retrying.');
   throw Error('Runtime cancellation pending');
  }
 }));
 const failures=results.filter(r=>r.status==='rejected').length;
 if(failures)throw Error(`${failures} runtime cancellations remain pending`);
}
