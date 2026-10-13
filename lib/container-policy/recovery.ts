import {db} from '../db';
import type {ContainerBuild} from './store';

export type RecoveryBuild=ContainerBuild&{
 provider_session_id:string|null;provider_status:string|null;job_token:string;job_until:string;
 next_at:string;reconcile_until:string;creation_job_token:string|null;failures:number;message:string;
};
export type ProviderStatus='pending'|'running'|'stopping'|'snapshotting'|'stopped'|'failed'|'aborted';
export type ProviderObservation={name:string;sessionId:string;status:ProviderStatus;stop:(signal:AbortSignal)=>Promise<void>};
export type BuildProvider={create:(build:RecoveryBuild,signal:AbortSignal)=>Promise<ProviderObservation>;observe:(build:RecoveryBuild,signal:AbortSignal)=>Promise<ProviderObservation|null>};
export type RecoveryStore={
 job:(student:string,id:string)=>Promise<{build:RecoveryBuild;createProvider:boolean}|null>;
 allowed:(build:RecoveryBuild)=>Promise<boolean>;
 receipt:(build:RecoveryBuild,observation:ProviderObservation)=>Promise<boolean>;
 notStarted:(build:RecoveryBuild)=>Promise<boolean>;
 finish:(build:RecoveryBuild,message:string,error:boolean)=>Promise<boolean>;
};
async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{const r=await db().rpc(name,args);if(r.error)throw Error(r.error.message);return r.data as T;}
export const recoveryStore:RecoveryStore={
 job:(student,id)=>rpc('container_policy_build_job',{p_student:student,p_id:id}),
 allowed:b=>rpc('container_policy_build_allowed',{p_student:b.student_id,p_id:b.id,p_job:b.job_token}),
 receipt:(b,o)=>rpc('container_policy_build_provider',{p_student:b.student_id,p_id:b.id,p_provision:b.provision_token,p_name:o.name,p_session:o.sessionId,p_status:o.status}),
 notStarted:b=>rpc('container_policy_build_not_started',{p_student:b.student_id,p_id:b.id,p_job:b.job_token}),
 finish:(b,message,error)=>rpc('container_policy_build_job_finish',{p_student:b.student_id,p_id:b.id,p_job:b.job_token,p_message:message,p_error:error}),
};
export type BuildWork=(build:RecoveryBuild,signal:AbortSignal)=>Promise<{message:string;stop?:boolean}>;
const terminal=(status:ProviderStatus)=>['stopped','failed','aborted'].includes(status);

/** One bounded provider-recovery pass. Optional command work runs only after a
 * physical-session receipt and fresh authority check. Without work it only observes.
 * Kept outside the dispatcher until artifact/command recovery is integrated. */
export async function reconcileContainerProvider(student:string,id:string,provider:BuildProvider,store:RecoveryStore=recoveryStore,work?:BuildWork,outerSignal?:AbortSignal){
 outerSignal?.throwIfAborted();
 const job=await store.job(student,id);if(!job)return {state:'idle'} as const;
 const b=job.build,signal=AbortSignal.any([AbortSignal.timeout(55000),...outerSignal?[outerSignal]:[]]);let requested=false;
 if(b.student_id!==student||b.id!==id)throw Error('Build recovery scope mismatch');
 try{
  signal.throwIfAborted();
  let observed:ProviderObservation|null;
  if(job.createProvider){
   if(!await store.allowed(b)){
    if(!await store.notStarted(b))throw Error('Unstarted build receipt could not be recorded');
    return {state:'stopped'} as const;
   }
   // Set before the call. A timeout or synchronous provider error is uncertain;
   // this process must never later assert that creation was not requested.
   signal.throwIfAborted();requested=true;observed=await provider.create(b,signal);
  }else observed=await provider.observe(b,signal);
  if(!observed){
   await store.finish(b,'Original builder not found; creation remains uncertain and will not be repeated',true);
   return {state:'waiting'} as const;
  }
  if(observed.name!==b.provider_name||b.provider_session_id&&observed.sessionId!==b.provider_session_id)throw Error('Provider identity mismatch');
  if(!await store.receipt(b,observed))throw Error('Provider receipt was not accepted');
  if(terminal(observed.status))return {state:'stopped'} as const;
  if(b.state==='stopping'||!await store.allowed(b)){
   // Use the immutable physical session's stop method. A stop response alone
   // does not prove termination; a later pass must observe terminal state.
   await observed.stop(outerSignal?.aborted?AbortSignal.timeout(15000):signal);
   await store.finish(b,'Provider accepted shutdown; awaiting observed terminal state',false);
   return {state:'waiting'} as const;
  }
  signal.throwIfAborted();
  if(observed.status==='running'&&work){
   const result=await work({...b,provider_session_id:observed.sessionId,provider_status:observed.status},signal);
   if(result.stop)await observed.stop(outerSignal?.aborted?AbortSignal.timeout(15000):signal);
   await store.finish(b,result.message,false);
   return {state:result.stop?'waiting':'ready',sessionId:observed.sessionId} as const;
  }
  await store.finish(b,observed.status==='running'?'Hosted builder ready for the admitted command':'Waiting for the original builder to start',false);
  return {state:observed.status==='running'?'ready':'waiting',sessionId:observed.sessionId} as const;
 }catch{
  // If the original job failed before making any provider call, it alone can
  // confirm no request was issued. Replacement jobs have no such knowledge.
  if(job.createProvider&&!requested)await store.notStarted(b);
  await store.finish(b,'Builder status remains uncertain; observe the original provider without recreating it',true);
  return {state:'waiting'} as const;
 }
}
