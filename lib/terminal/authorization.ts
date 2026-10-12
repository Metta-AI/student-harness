import type {SessionAuth} from 'eve/context';
import {z} from 'zod';
import {db} from '../db';
import {canRunBackground} from '../research/execution-control';

export async function requireTerminalExecution(studentId:string,sessionId:string,auth:SessionAuth) {
 if(await canRunBackground(studentId))return;
 const principal=auth.current??auth.initiator;
 if(principal?.authenticator==='student-harness'&&principal.principalId===studentId){
  // Stream reconnection can refresh the principal without the POST's client context.
  // A previously bound allowance is durable; its owner/session/expiry fences still apply.
  const {data:bound,error:lookupError}=await db().from('research_terminal_grants').select('id').eq('student_id',studentId).eq('session_id',sessionId).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(lookupError)throw Error('Could not check this session’s research allowance. Retry when the connection recovers.');
  const grant=bound?.id??principal.attributes.terminalGrant;
  const id=z.uuid().safeParse(grant);
  if(id.success){
   const {data,error}=await db().rpc('research_terminal_allowed',{p_student:studentId,p_id:id.data,p_session:sessionId});
   if(error)throw Error('Could not check this session’s research allowance. Retry when the connection recovers.');
   if(data===true)return;
  }
 }
 throw Error('This research session is not authorized or its allowance expired. Send a new direction or resume from this workspace. Other background research remains held.');
}

/** Revoke only this conversation's allowance after its worker has stopped. */
export async function releaseTerminalExecution(studentId:string,sessionId:string) {
 const {error}=await db().from('research_terminal_grants').update({expires_at:new Date().toISOString()}).eq('student_id',studentId).eq('session_id',sessionId);
 if(error)throw Error('The loop stopped, but its research allowance could not be released.');
}
