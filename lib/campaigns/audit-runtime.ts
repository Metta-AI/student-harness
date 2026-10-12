import {setTimeout as delay} from 'node:timers/promises';
import {Sandbox} from '@vercel/sandbox';
import {db} from '../db';
import {rpc} from '../tasks/store';
import type {Release} from './model';
export type AuditSession={id:string;student_id:string;task_id:string;campaign_id:string|null;vm_name:string;sealed_key:string;state:string;release:Release;control_epoch:number;runtime_token:string|null;runtime_until:string|null;runtime_session_id:string|null;provision_pending:boolean;retry_setup:boolean};
export type AuditStop={id:string;audit_session_id:string;student_id:string;lease_token:string;epoch:number};
export async function checkAuditOperation(a:AuditSession){
 if(!await rpc<boolean>('audit_runtime_check',{p_id:a.id,p_token:a.runtime_token,p_epoch:a.control_epoch}))throw Error('Replay computer operation was paused or replaced');
}
/** Admit effects separately from obtaining an endpoint; a pause between the two
 * must not allow a new validation or replay job. */
export async function withAuditOperation<T>(a:AuditSession,operation:(signal:AbortSignal)=>Promise<T>):Promise<T>{
 const lease=await rpc<AuditSession|null>('audit_runtime_begin',{p_id:a.id,p_student:a.student_id,p_epoch:a.control_epoch,p_provision:false,p_session:a.runtime_session_id});
 if(!lease)throw Error('Replay computer is paused, busy, or awaiting confirmed shutdown');
 try{await checkAuditOperation(lease);return await operation(AbortSignal.timeout(45000));}
 finally{await rpc('audit_runtime_release',{p_id:a.id,p_token:lease.runtime_token});}
}
export async function observeAuditShutdown(name:string,signal:AbortSignal):Promise<{observation:string;sessionId:string|null}>{
 let sandbox:Sandbox;
 try{sandbox=await Sandbox.get({name,resume:false,signal});}
 catch(error){
  if(error instanceof Error&&'response' in error&&(error.response as Response)?.status===404)return {observation:'absent',sessionId:null};
  throw error;
 }
 let session;
 try{session=sandbox.currentSession();}catch(error){
  // SDK 3.5: a named sandbox without a session has no current compute. Never
  // run a command here: the SDK would implicitly resume it.
  if(error instanceof Error&&error.message==='No active session. Run a command or call resume first.')return {observation:'absent',sessionId:null};
  throw error;
 }
 const sessionId=session.sessionId;
 if(['stopped','failed','aborted'].includes(session.status))return {observation:session.status,sessionId};
 // This Session instance binds to an immutable provider session ID. It cannot
 // accidentally stop a subsequently resumed incarnation of the named sandbox.
 const stopped=await session.stop({signal});
 return {observation:stopped.session.status,sessionId};
}
export async function dispatchAuditStops(){
 const stops=await rpc<AuditStop[]>('audit_claim_stops');
 const deadline=AbortSignal.timeout(45000);
 let nextReadAt=0;
 for(const stop of stops){
  if(deadline.aborted)break;
  let observation='unknown',sessionId:string|null=null,error:string|null=null;
  try{
   const result=await db().from('research_audit_sessions').select('vm_name').eq('id',stop.audit_session_id).eq('student_id',stop.student_id).abortSignal(deadline).single();
   if(result.error||!result.data)throw Error('Audit session unavailable');
   if(nextReadAt>Date.now())await delay(nextReadAt-Date.now(),undefined,{signal:deadline});
   deadline.throwIfAborted();nextReadAt=Date.now()+2010;
   const observed=await observeAuditShutdown(result.data.vm_name,AbortSignal.any([deadline,AbortSignal.timeout(10000)]));
   observation=observed.observation;sessionId=observed.sessionId;
  }catch{error='Replay computer shutdown could not be confirmed; delivery will retry';}
  await rpc('audit_finish_stop',{p_id:stop.id,p_token:stop.lease_token,p_observation:observation,p_session:sessionId,p_error:error});
 }
}
