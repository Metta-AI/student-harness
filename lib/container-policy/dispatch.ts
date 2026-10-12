import {db} from '../db';
import {reconcileHostedBuild} from './controller';
import type {PolicyArtifactStorage} from '../../workers/policy-build/storage.mjs';

export type ContainerDispatchScope={studentId:string;leagueId:string};
export type ContainerBuildCandidate={id:string;student_id:string;state:string;next_at:string;job_until:string|null;cleanup_confirmed_at:string|null;container_policy_revisions:{league_id:string}};
export type ContainerDispatchPorts={
 candidates:(scope:ContainerDispatchScope,now:string,limit:number)=>Promise<ContainerBuildCandidate[]>;
 reconcile:typeof reconcileHostedBuild;
 now:()=>number;
};
const active=new Set(['queued','provisioning','building','retaining','stopping']);
const PAGE_SIZE=8,CONCURRENCY=2;
export const containerDispatchCandidates:ContainerDispatchPorts['candidates']=async(scope,now,limit)=>{
 const result=await db().from('container_policy_builds')
  .select('id,student_id,state,next_at,job_until,cleanup_confirmed_at,container_policy_revisions!inner(league_id)')
  .eq('student_id',scope.studentId).eq('container_policy_revisions.league_id',scope.leagueId)
  .in('state',[...active]).is('cleanup_confirmed_at',null).lte('next_at',now)
  .or(`job_until.is.null,job_until.lte.${now}`).order('next_at').order('id').limit(limit)
  .abortSignal(AbortSignal.timeout(10000));
 if(result.error)throw Error('Hosted build candidates could not load');
 // PostgREST infers the FK join as an array without a generated database schema.
 // The runtime scope check below requires the actual many-to-one object.
 return result.data as unknown as ContainerBuildCandidate[];
};
export type ContainerDispatchResult={examined:number;skipped:number;results:Array<{id:string;state:'reconciled'|'error';result?:Awaited<ReturnType<typeof reconcileHostedBuild>>}>};

/** A bounded page, with concurrent calls for the same account/league sharing one
 * pass. This map is only a process-local optimization. The SQL job claim owns
 * the one-minute cadence, exponential backoff, exclusion and account budget.
 * Do not filter execution holds here: the claim fences work and must still run
 * to request cleanup of the original provider after Stop or an account hold.
 * Nothing starts until explicitly called by an authenticated scheduler. */
export function createContainerBuildDispatcher(ports:ContainerDispatchPorts={candidates:containerDispatchCandidates,reconcile:reconcileHostedBuild,now:Date.now}){
 const pending=new Map<string,Promise<ContainerDispatchResult>>();
 return function dispatch(scope:ContainerDispatchScope,storage:PolicyArtifactStorage,signal?:AbortSignal):Promise<ContainerDispatchResult>{
  if(signal?.aborted)return Promise.reject(signal.reason);
  if(!scope.studentId||scope.studentId.length>512||!/^league_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(scope.leagueId))return Promise.reject(Error('Invalid hosted build dispatch scope'));
  const key=JSON.stringify([scope.studentId,scope.leagueId]),existing=pending.get(key);if(existing)return existing;
  const run=(async()=>{
   const now=ports.now(),rows=(await ports.candidates(scope,new Date(now).toISOString(),PAGE_SIZE)).slice(0,PAGE_SIZE);
   const seen=new Set<string>(),eligible=rows.filter(b=>{
    if(!b||typeof b.id!=='string'||!b.id||seen.has(b.id)||b.student_id!==scope.studentId||b.container_policy_revisions?.league_id!==scope.leagueId||!active.has(b.state)||b.cleanup_confirmed_at!==null)return false;
    if(!Number.isFinite(Date.parse(b.next_at))||Date.parse(b.next_at)>now||b.job_until!==null&&(!Number.isFinite(Date.parse(b.job_until))||Date.parse(b.job_until)>now))return false;
    seen.add(b.id);return true;
   }).sort((a,b)=>Date.parse(a.next_at)-Date.parse(b.next_at)||a.id.localeCompare(b.id));
   const results:ContainerDispatchResult['results']=new Array(eligible.length);let cursor=0;
   await Promise.all(Array.from({length:Math.min(CONCURRENCY,eligible.length)},async()=>{
    while(cursor<eligible.length){const index=cursor++,b=eligible[index];
     try{signal?.throwIfAborted();results[index]={id:b.id,state:'reconciled',result:await ports.reconcile(scope.studentId,b.id,storage,undefined,signal)};}
     catch{results[index]={id:b.id,state:'error'};}
    }
   }));
   return {examined:rows.length,skipped:rows.length-eligible.length,results};
  })();
  pending.set(key,run);void run.finally(()=>{if(pending.get(key)===run)pending.delete(key);}).catch(()=>{});return run;
 };
}
export const dispatchContainerBuilds=createContainerBuildDispatcher();
