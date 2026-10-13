import {createHash} from 'node:crypto';
import {db} from '../db';
import {rpc} from '../tasks/store';
import {sealJson,unsealJson} from '../crypto';
import {browserTransport} from '../browser/transport';
import {assertVoiceActive} from '../voice/session-access';
import {computerActionInput,reviewedCommand,type ComputerReview} from './review-input';
type Row={id:string;student_id:string;computer_id:string;voice_session:string;call_id:string;intent:string;sealed_command:string;status:string;expires_at:string;result:unknown};
const operation=(r:Row)=>createHash('sha256').update(`computer-review:${r.id}`).digest('hex');
function command(r:Row){
 const sealed=unsealJson(r.sealed_command) as {student:string;computer:string;session:string;call:string;command:unknown};
 if(sealed.student!==r.student_id||sealed.computer!==r.computer_id||sealed.session!==r.voice_session||sealed.call!==r.call_id)throw Error('Review scope changed');
 return reviewedCommand.parse(sealed.command);
}
function present(r:Row):ComputerReview{return {id:r.id,computerId:r.computer_id,intent:r.intent,command:command(r),status:r.status==='pending'&&Date.parse(r.expires_at)<=Date.now()?'expired':r.status==='running'?'unknown':r.status,expiresAt:r.expires_at,operationId:operation(r),url:`/computer/${r.computer_id}#review-${r.id}`,result:r.result};}
async function owned(student:string,id:string){const r=await db().from('computer_action_reviews').select('*').eq('student_id',student).eq('id',id).maybeSingle();if(r.error||!r.data)throw Error('Review unavailable');return r.data as Row;}
export async function listComputerReviews(student:string,computerId:string){
 const r=await db().from('computer_action_reviews').select('*').eq('student_id',student).eq('computer_id',computerId).order('created_at',{ascending:false}).limit(12);
 if(r.error)throw Error('Computer reviews unavailable');return {reviews:(r.data as Row[]).map(present)};
}
const finish=(student:string,id:string,status:string,result:unknown)=>rpc<Row>('computer_review_finish',{p_student:student,p_id:id,p_status:status,p_result:result});
export async function computerReviewStatus(student:string,id:string){
 let row=await owned(student,id);
 if(['running','unknown'].includes(row.status)){
  try{
   const receipt=await browserTransport(student,row.computer_id,'agent','/receipt',undefined,operation(row),'desktop');
   if(receipt.available&&receipt.status==='completed')row=await finish(student,id,'completed',{confirmedBy:'worker_receipt'});
   else if(row.status==='running')row=await finish(student,id,'unknown',{reason:'Execution was not confirmed. No input has been retried.'});
  }catch{/* Admission loss never implies that an earlier input did not happen. */}
 }
 return present(row);
}
export async function proposeComputerAction(student:string,session:string,expires:number,callId:string,input:unknown){
 if(Date.now()>=expires)throw Error('Voice expired');await assertVoiceActive(student,session);
 const p=computerActionInput.parse(input);
 if(p.action==='status')return computerReviewStatus(student,p.reviewId);
 // Preserve idempotency even if a previous proposal's view is no longer current.
 const prior=await db().from('computer_action_reviews').select('*').eq('student_id',student).eq('voice_session',session).eq('call_id',callId).maybeSingle();
 if(prior.error)throw Error('Review lookup unavailable');
 if(!prior.data){const state=await browserTransport(student,p.computerId,'agent','/state',undefined,undefined,'desktop');if(state.owner!=='agent'||state.epoch!==p.command.epoch||state.view!==p.command.view)throw Error('Desktop control or view changed; inspect it again');}
 const fingerprint=createHash('sha256').update(JSON.stringify(p)).digest('hex');
 const row=await rpc<Row>('computer_review_create',{p_student:student,p_computer:p.computerId,p_session:session,p_call:callId,p_fingerprint:fingerprint,p_intent:p.intent,p_sealed:sealJson({student,computer:p.computerId,session,call:callId,command:p.command})});
 return present(row);
}
export async function decideComputerReview(student:string,id:string,approve:boolean){
 const claim=await rpc<{claimed:boolean;review:Row}>('computer_review_decide',{p_student:student,p_id:id,p_approve:approve});
 if(!claim.claimed)return computerReviewStatus(student,id);
 const row=claim.review;
 let status='unknown',result:unknown={reason:'Execution was not confirmed. Inspect the receipt; do not repeat this input.'};
 try{
  await assertVoiceActive(student,row.voice_session);
  const response=await browserTransport(student,row.computer_id,'agent','/command',{...command(row),id:operation(row)},undefined,'desktop');
  if(response.status==='completed'){status='completed';result={confirmedBy:'worker_response'};}
  else if(response.status==='rejected'&&response.admitted===false){status='rejected';result={reason:'The screenshot expired or changed. No input was admitted. Obtain a new observation and review.'};}
 }catch{/* Never repeat an input after an uncertain response. */}
 try{return present(await finish(student,id,status,result));}catch{return present({...row,status:'unknown',result});}
}
