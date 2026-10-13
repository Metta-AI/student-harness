import {z} from 'zod';
import {db} from './db';
import {leagueIdSchema} from './league-catalog';
import {getLeague,getDefaultPlayer,listUploadedPolicies,lookupLeagueSubmission,createLeagueSubmission,SoftmaxError,type ScopedLeagueSubmission} from './softmax';

async function rpc(name:string,args:Record<string,unknown>){const r=await db().rpc(name,args);if(r.error)throw Error(r.error.message);return r.data;}
const requestSchema=z.object({id:z.uuid(),student_id:z.string(),league_id:leagueIdSchema,policy_version_id:z.uuid(),player_id:z.string(),state:z.enum(['uncertain','recorded','rejected']),error:z.string().nullable(),receipt:z.unknown()});
/** Invoked only by the chat tool after its existing explicit approval boundary. */
export async function enterSelectedLeague(student:{subjectId:string;token:string},leagueId:string,policyId:string){
 leagueIdSchema.parse(leagueId);z.uuid().parse(policyId);
 const versions=await listUploadedPolicies(student.token,{policyVersionId:policyId});
 const version=versions.find(v=>v.policy_version_id===policyId);
 if(!version)throw Error('This policy version is not uploaded under your account. A draft must be built and uploaded first.');
 const player=version.player_id?{id:version.player_id,name:version.player_name??'Your player'}:await getDefaultPlayer(student.token);
 if(!player)throw Error('No active player is available for your account.');
 const label=`${version.policy_name}:v${version.version}`;
 const scope={p_student:student.subjectId,p_league:leagueId,p_policy:policyId,p_player:player.id};
 const existing=await lookupLeagueSubmission(student.token,leagueId,policyId,player.id);
 if(!existing){
  const league=await getLeague(student.token,undefined,leagueId);
  if(league.id!==leagueId)throw Error('Selected league identity mismatch');
  if(league.submissions_locked_at)throw Error('This league is currently closed to new submissions.');
 }
 const claim=z.object({request:requestSchema,can_submit:z.boolean()}).parse(await rpc('chat_league_submission_claim',scope));
 const r=claim.request;
 if(r.student_id!==student.subjectId||r.league_id!==leagueId||r.policy_version_id!==policyId||r.player_id!==player.id)throw Error('Submission admission scope mismatch');
 const record=async(receipt:ScopedLeagueSubmission,alreadySubmitted=false)=>{
  if(receipt.league.id!==leagueId||receipt.policy_version.id!==policyId||receipt.player.id!==player.id)throw Error('Submission receipt scope mismatch');
  await rpc('chat_league_submission_record',{p_student:student.subjectId,p_id:r.id,p_receipt:receipt,p_error:null});
  return {league_id:leagueId,policy_version_id:policyId,policy_label:label,player:receipt.player.name,submission_id:receipt.id,status:receipt.status,already_submitted:alreadySubmitted};
 };
 if(existing)return record(existing,true);
 if(!claim.can_submit){
  if(r.state==='rejected')throw Error(r.error??'The platform rejected this submission.');
  return {league_id:leagueId,policy_version_id:policyId,policy_label:label,status:'uncertain',message:'The original submission has not been confirmed yet. No duplicate was sent. Check league_submission_status for this version.'};
 }
 let receipt:ScopedLeagueSubmission;
 try{receipt=await createLeagueSubmission(student.token,leagueId,policyId,player.id);}
 catch(error){
  // A lost response or conflicting in-flight request must be read back, not retried.
  const observed=await lookupLeagueSubmission(student.token,leagueId,policyId,player.id).catch(()=>null);
  if(observed)return record(observed);
  if(error instanceof SoftmaxError&&error.status>=400&&error.status<500&&![408,409,429].includes(error.status)){
   await rpc('chat_league_submission_record',{p_student:student.subjectId,p_id:r.id,p_receipt:null,p_error:error.message});throw error;
  }
  return {league_id:leagueId,policy_version_id:policyId,policy_label:label,status:'uncertain',message:'The platform response is uncertain. The original request is recorded; use league_submission_status to check it. Do not submit a replacement.'};
 }
 return record(receipt);
}
