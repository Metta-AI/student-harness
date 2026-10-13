import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {db,studentToken} from '../db';
import {validatePracticePlan,type PracticePlan} from './practice-plan';
import * as upstream from './practice-api';

const timestamp=z.string().refine(value=>Number.isFinite(Date.parse(value)));
export const practiceRowSchema=z.object({
 id:z.uuid(),student_id:z.string().min(1),upload_id:z.uuid(),build_id:z.uuid(),revision_id:z.uuid(),league_id:z.string().min(1),player_id:z.string().min(1),policy_version_id:z.uuid(),coworld_id:z.string(),manifest_hash:z.string(),
 plan:z.unknown().transform(value=>validatePracticePlan(value)),request_key:z.string().min(8).max(160),request_body:z.string().max(131072),request_sha256:z.string().regex(/^[a-f0-9]{64}$/),operation_key:z.string().min(1).max(200),
 state:z.enum(['queued','submitting','running','uncertain','completed','failed','canceled','expired']),xp_request_id:z.string().regex(/^xreq_[a-zA-Z0-9_-]{8,100}$/).nullable(),next_at:timestamp.nullable(),lease_until:timestamp.nullable(),
 lease_token:z.uuid().nullable(),submit_token:z.uuid().nullable(),deadline_at:timestamp,reconcile_until:timestamp,cancel_requested_at:timestamp.nullable(),
 result:z.unknown().nullable(),cost_usd:z.number().finite().nonnegative().nullable(),remote_status:z.string().nullable(),
}).passthrough();
export type PracticeRow=z.infer<typeof practiceRowSchema>;
export type PracticeStore={rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>};
export const practiceStore:PracticeStore={async rpc(name,args){
 const result=await db().rpc(name,args).abortSignal(AbortSignal.timeout(10000));
 if(result.error)throw Error('Container practice journal operation failed');
 return result.data;
}};
const api={create:upstream.createPracticeRequest,read:upstream.readPracticeRequest,cancel:upstream.cancelPracticeRequest};
export type PracticePorts={store:PracticeStore;token:(studentId:string)=>Promise<string>;api:typeof api;now:()=>number};
const defaults:PracticePorts={store:practiceStore,token:studentToken,api,now:Date.now};
const terminalStates=new Set(['completed','failed','canceled','expired']);

/** Advance only an existing admission. SQL owns leases, one-minute cadence and
 * the original grant. A lost create acknowledgement may replay only the exact
 * saved idempotent request while that grant remains active. Stop/hold/expiry
 * permit reconciliation of a known request, never creation to discover its ID. */
export async function advanceContainerPractice(studentId:string,practiceId:string,signal?:AbortSignal,ports:PracticePorts=defaults){
 z.string().min(1).max(512).parse(studentId);z.uuid().parse(practiceId);signal?.throwIfAborted();
 const claimed=await ports.store.rpc('container_policy_practice_claim',{p_student:studentId,p_id:practiceId});
 if(!claimed||typeof claimed==='object'&&'id' in claimed&&claimed.id===null)return {state:'busy'} as const;
 let row=practiceRowSchema.parse(claimed);
 const original=structuredClone(row),plan:PracticePlan=validatePracticePlan(row.plan);
 const validate=(value:unknown)=>{
  const next=practiceRowSchema.parse(value);
  if(next.id!==practiceId||next.student_id!==studentId)throw Error('Container practice account mismatch');
  for(const key of ['id','student_id','upload_id','build_id','revision_id','league_id','player_id','policy_version_id','coworld_id','manifest_hash','plan','request_key','request_body','request_sha256','operation_key','deadline_at','reconcile_until'] as const){
   if(!isDeepStrictEqual(next[key],original[key]))throw Error('Container practice admission identity changed');
  }
  if(plan.leagueId!==next.league_id||plan.coworldId!==next.coworld_id||plan.manifestHash!==next.manifest_hash||plan.policyVersionId!==next.policy_version_id||plan.requestBody!==next.request_body||plan.requestSha256!==next.request_sha256||plan.idempotencyKey!==next.operation_key)throw Error('Container practice request identity mismatch');
  if(row.xp_request_id&&next.xp_request_id!==row.xp_request_id)throw Error('Original practice request changed');
  return next;
 };
 validate(row);
 // Completed receipts are immutable. Even a stopped local operation may have a
 // terminal late receipt; never poll it again or replace unknown cost with zero.
 if(row.result&&typeof row.result==='object'&&'terminal' in row.result&&row.result.terminal===true)return {state:row.state,requestId:row.xp_request_id,receipt:row.result};
 if(terminalStates.has(row.state)&&!row.xp_request_id)return {state:row.state,requestId:null};
 const remaining=Date.parse(row.reconcile_until)-ports.now();
 if(remaining<=0)return {state:row.state,requestId:row.xp_request_id,message:'The original practice reconciliation deadline has ended.'};
 if(!row.lease_token)throw Error('Container practice lease missing');
 const args={p_student:studentId,p_id:practiceId,p_token:row.lease_token};
 const active=AbortSignal.any([AbortSignal.timeout(Math.min(60000,Math.ceil(remaining))),...signal?[signal]:[]]);
 let submitting=false,failed=false;
 const record=async(stage:string,value:unknown,late=false)=>{
  row=validate(await ports.store.rpc('container_policy_practice_record',{...args,p_token:late?(row.submit_token??args.p_token):args.p_token,p_stage:stage,p_value:value}));return row;
 };
 const authorize=async(action:'submit'|'read'|'cancel')=>{
  active.throwIfAborted();
  row=validate(await ports.store.rpc('container_policy_practice_authorize',{...args,p_action:action}));
  if(row.lease_token!==args.p_token)throw Error('Container practice lease changed');
  if(action==='submit'&&(row.cancel_requested_at||ports.now()>=Date.parse(row.deadline_at)||terminalStates.has(row.state)))throw Error('Container practice submission authority ended');
  active.throwIfAborted();
 };
 const saveReceipt=async(receipt:upstream.PracticeReceipt)=>{
  if(!row.xp_request_id||receipt.requestId!==row.xp_request_id)throw Error('Original practice response changed');
  await record('result',receipt);return {state:row.state,requestId:row.xp_request_id,receipt:row.result};
 };
 try{
  const token=await ports.token(studentId);
  const scope=(action:'submit'|'read'|'cancel')=>({token,subjectId:studentId,playerId:row.player_id,authorize:()=>authorize(action)});
  if(row.xp_request_id){
   let action:'cancel'|'read'=row.cancel_requested_at||ports.now()>=Date.parse(row.deadline_at)||terminalStates.has(row.state)?'cancel':'read';
   await authorize(action);
   // Authorization may discover an account hold or concurrent Stop after claim.
   if(action==='read'&&(row.cancel_requested_at||ports.now()>=Date.parse(row.deadline_at)||terminalStates.has(row.state))){action='cancel';await authorize(action);}
   return await saveReceipt(await ports.api[action](scope(action),plan,row.xp_request_id,active));
  }
  // This check supplements SQL. It never grants authority when SQL denies a
  // budget hold, Stop, replacement lease, or expired original admission.
  if(row.cancel_requested_at||ports.now()>=Date.parse(row.deadline_at))return {state:row.state,requestId:null};
  await authorize('submit');submitting=true;
  const receipt=await ports.api.create(scope('submit'),plan,active);
  // Save the returned original ID before any subsequent network call, even if
  // Stop or lease replacement won while create was in flight.
  await record('submitted',{requestId:receipt.requestId},true);
  return await saveReceipt(receipt);
 }catch(error){
  failed=true;
  if(submitting){
   if(error instanceof upstream.PracticeApiError){
    if(error.requestId)await record('submitted',{requestId:error.requestId},true).catch(()=>{});
    // A replay can fail authentication or target lookup before the upstream
    // idempotency lookup. That does not disprove an earlier accepted request.
    const earlierSubmission=original.submit_token!==null||['submitting','uncertain','running'].includes(original.state);
    const definitive=!earlierSubmission&&!error.uncertain&&error.status>=400&&error.status<500&&![408,409,429].includes(error.status);
    await record(definitive?'rejected':'uncertain',definitive?{status:error.status}:error.requestId?{requestId:error.requestId}:{},true).catch(()=>{});
   }else await record('uncertain',{},true).catch(()=>{});
  }
  // Upstream diagnostics may contain private policy inputs or credentials.
  return {state:row.xp_request_id?'waiting':submitting?'uncertain':'waiting',requestId:row.xp_request_id,message:'The original practice operation remains recorded for recovery.'};
 }finally{
  await ports.store.rpc('container_policy_practice_finish',{...args,p_error:failed}).catch(()=>{});
 }
}
