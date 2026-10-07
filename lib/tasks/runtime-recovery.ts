import {Client} from 'eve/client';
import {db,studentToken} from '../db';
import {cookieName,seal} from '../student-session';
import {rpc} from './store';
import {isProviderBillingFailure,isProviderConfigurationFailure} from './failure';
import type {MessageStreamEvent} from 'eve/client';

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
 const origin=process.env.PRESTON_RUNTIME_URL??(process.env.NODE_ENV!=='production'?'http://localhost:3000':null);
 if(!origin)return;
 const url=new URL(origin);
 if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Runtime recovery requires HTTPS outside localhost');
 const {data:tasks,error}=await db().from('agent_tasks').select('id,student_id,session_id')
  .in('status',['running','queued']).not('session_id','is',null)
  .lt('updated_at',new Date(Date.now()-120000).toISOString()).order('updated_at').limit(3);
 if(error)throw Error('Could not check session recovery');
 await Promise.allSettled((tasks??[]).map(async task=>{
  const {data:student,error}=await db().from('students').select('email').eq('subject_id',task.student_id).single();
  if(error||!student)return;
  const client=new Client({host:url.origin,headers:{Cookie:`${cookieName}=${seal({subjectId:task.student_id,email:student.email,token:await studentToken(task.student_id)})}`}});
  const message=await failedRuntime(client.sessions.attach(task.session_id!).stream({follow:false,
   signal:AbortSignal.timeout(8000),streamReconnectPolicy:{reconnect:false}}));
  if(message)await rpc('task_runtime_failed',{p_session:task.session_id,p_message:message.slice(0,1000),
   p_attention:isProviderBillingFailure(message)||isProviderConfigurationFailure(message)});
 }));
}
