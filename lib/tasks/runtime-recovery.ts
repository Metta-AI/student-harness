import {Client} from 'eve/client';
import {db,studentToken} from '../db';
import {cookieName,seal} from '../student-session';
import {rpc} from './store';
import {isProviderBillingFailure,isProviderConfigurationFailure} from './failure';
import type {MessageStreamEvent} from 'eve/client';
import {runtimeRecoveryTarget} from './runtime-target';
import {runtimeOwner} from './runtime-owner';

/** Only a definitive terminal event authorizes recovery; silence/timeouts do not. */
export async function failedRuntime(events:AsyncIterable<MessageStreamEvent>):Promise<string|null>{
 let failure:string|null=null;
 for await(const event of events){
  if(event.type==='session.failed')failure=event.data.message||'Agent runtime stopped';
  else if(['session.started','turn.started','session.completed'].includes(event.type))failure=null;
 }
 return failure;
}

/** Backstop for terminal callbacks lost during an outage. At most three stale
 * roots are inspected per pass; research children and active model work stay put. */
export async function reconcileTaskRuntimes(){
 const owner=runtimeOwner();
 const target=runtimeRecoveryTarget();
 const tasks=await rpc<{id:string;student_id:string;session_id:string;generation?:number;runtime_id?:string|null}[]>(owner?'task_claim_runtime_checks_scoped':'task_claim_runtime_checks',owner?{p_runtime:owner}:undefined);
 const results=await Promise.allSettled(tasks.map(async task=>{
  // Configuration owns routing. An unexpected claim must never select a host or
  // receive a student's credentials, including an unbound legacy execution.
  if(owner&&(task.runtime_id!==owner||!Number.isSafeInteger(task.generation)||(task.generation??-1)<0||
   !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(task.id)||
   typeof task.student_id!=='string'||!task.student_id||typeof task.session_id!=='string'||!task.session_id))throw Error('Runtime observation ownership unavailable');
  const {data:student,error}=await db().from('students').select('email').eq('subject_id',task.student_id).single();
  if(error||!student)throw Error('Runtime recovery account unavailable');
  const client=new Client({...target,headers:{...target.headers,Cookie:`${cookieName}=${seal({subjectId:task.student_id,email:student.email,token:await studentToken(task.student_id)})}`}});
  const message=await failedRuntime(client.sessions.attach(task.session_id!).stream({follow:false,
   signal:AbortSignal.timeout(8000),streamReconnectPolicy:{reconnect:false}}));
  if(message)await rpc(owner?'task_runtime_failed_scoped':'task_runtime_failed',{...(owner?{p_runtime:owner,p_task:task.id,p_generation:task.generation}:{}),p_session:task.session_id,p_message:message.slice(0,1000),
   p_attention:isProviderBillingFailure(message)||isProviderConfigurationFailure(message)});
 }));
 const failed=results.filter(result=>result.status==='rejected').length;
 // HTTP/auth/timeout errors are observation failures, never task failures.
 // Avoid logging provider bodies, sealed cookies, or bypass credentials.
 if(failed)throw Error(`Runtime recovery could not inspect ${failed} of ${tasks.length} sessions; check runtime access and deployment protection`);
}
