import {z} from 'zod';
import {canonicalPracticeJSON,validatePracticePlan,type PracticePlan} from './practice-plan';

const requestIdSchema=z.string().regex(/^xreq_[a-zA-Z0-9_-]{8,100}$/),episodeIdSchema=z.string().regex(/^ereq_[a-zA-Z0-9_-]{8,100}$/);
const state=z.enum(['pending','submitted','running','completed','failed','cancelled']);
const score=z.object({position:z.number().int().min(0).max(31),score:z.number().finite()});
const episodeSchema=z.object({id:episodeIdSchema,requester_user_id:z.string(),coworld_id:z.string(),coworld_version:z.string(),round_id:z.null(),status:state,game_config:z.record(z.string(),z.unknown()),participants:z.array(z.object({position:z.number().int().min(0).max(31),kind:z.literal('policy'),policy_version_id:z.uuid(),player_id:z.string().nullable()})).max(32),policy_version_ids:z.array(z.uuid()).max(32),participant_scores:z.array(score).max(32),cost_usd:z.number().finite().nonnegative().nullable().optional(),replay_url:z.string().nullable().optional()});
const detailSchema=z.object({id:requestIdSchema,requester_user_id:z.string(),coworld_id:z.string(),coworld_version:z.string(),variant_id:z.string(),status:state,episode_count:z.literal(1),can_cancel:z.boolean(),episodes:z.array(episodeSchema).length(1),cost_preview:z.object({estimated_cost_credits:z.number().finite().nonnegative(),player_pod_llm_spend_limit_usd:z.number().finite().nonnegative().nullable()}).nullable().optional()});
export type PracticeScope={token:string;subjectId:string;playerId:string;authorize?:()=>Promise<void>};
export type PracticeReceipt={requestId:string;status:z.infer<typeof state>;terminal:boolean;canCancel:boolean;episodes:{id:string;status:z.infer<typeof state>;terminal:boolean;policyVersionIds:string[];participantScores:{position:number;score:number}[];costUsd:number|null;replayUrl:string|null}[];costUsd:number|null;estimatedCostCredits:number|null};
/** IDs attached to an error are unverified handles, never proof of ownership or success. */
export class PracticeApiError extends Error{
 readonly status:number;readonly uncertain:boolean;requestId?:string;
 constructor(status:number,message:string,uncertain=false){super(message);this.name='PracticeApiError';this.status=status;this.uncertain=uncertain;}
}
const terminal=(s:string)=>['completed','failed','cancelled'].includes(s);
const safeReplay=(v:string|null|undefined)=>{try{const u=new URL(v??'');return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
async function request(scope:PracticeScope,path:string,body:string|undefined,signal?:AbortSignal):Promise<unknown>{
 if(!scope.token||!scope.subjectId||!scope.playerId)throw new PracticeApiError(0,'Practice account and player identity are required');
 const combined=AbortSignal.any([AbortSignal.timeout(20000),...(signal?[signal]:[])]);combined.throwIfAborted();
 // A denied local authorization occurs before any network write and retains its original error.
 await scope.authorize?.();combined.throwIfAborted();
 let response:Response;
 try{response=await fetch(`${process.env.SOFTMAX_API_URL??'https://softmax.com/api'}/observatory${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${scope.token}`,'User-Agent':'softmax-student-harness/1.0',...(body===undefined?{}:{'Content-Type':'application/json'})},body,signal:combined,cache:'no-store',redirect:'error'});}
 catch{throw new PracticeApiError(0,'Hosted practice request did not return a confirmed response',body!==undefined);}
 if(!response.ok){await response.body?.cancel();throw new PracticeApiError(response.status,`Hosted practice request returned ${response.status}`,body!==undefined&&(response.status>=500||[408,409,429].includes(response.status)));}
 const reader=response.body?.getReader();let bytes=0;const chunks:Uint8Array[]=[];
 try{if(!reader)throw Error();for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>262144)throw Error();chunks.push(part.value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 catch{throw new PracticeApiError(0,'Hosted practice response could not be read within its bounds',body!==undefined);}
 finally{await reader?.cancel().catch(()=>{});reader?.releaseLock();}
}
function verify(scope:PracticeScope,plan:PracticePlan,value:unknown,expectedId?:string,uncertain=false):PracticeReceipt{
 const rawId=requestIdSchema.safeParse(value&&typeof value==='object'?(value as Record<string,unknown>).id:null);
 try{
  const result=detailSchema.parse(value);
  if((expectedId&&result.id!==expectedId)||result.requester_user_id!==scope.subjectId||result.coworld_id!==plan.coworldId||result.coworld_version!==plan.gameVersion||result.variant_id!==plan.variantId)throw Error();
  for(const ep of result.episodes){
   if(ep.requester_user_id!==scope.subjectId||ep.coworld_id!==plan.coworldId||ep.coworld_version!==plan.gameVersion||ep.participants.length!==plan.seatCount||ep.policy_version_ids.length!==plan.seatCount||ep.policy_version_ids.some(id=>id!==plan.policyVersionId))throw Error();
   const seen=new Set<number>();for(const p of ep.participants){if(p.position>=plan.seatCount||seen.has(p.position)||p.policy_version_id!==plan.policyVersionId||p.player_id!==scope.playerId)throw Error();seen.add(p.position);}
   // The runner may add tokens/defaults/runtime fields. Every admitted authored value must remain exact.
   for(const [key,value] of Object.entries(plan.gameConfig))if(canonicalPracticeJSON(ep.game_config[key])!==canonicalPracticeJSON(value))throw Error();
   const scores=new Set<number>();for(const s of ep.participant_scores){if(s.position>=plan.seatCount||scores.has(s.position))throw Error();scores.add(s.position);}
   if(ep.status==='completed'&&scores.size!==plan.seatCount)throw Error();
   if(terminal(result.status)&&!terminal(ep.status))throw Error();
   if(result.status==='completed'&&ep.status!=='completed')throw Error();
  }
  if(result.cost_preview&&result.cost_preview.player_pod_llm_spend_limit_usd!==0)throw Error();
  const episodes=result.episodes.map(ep=>({id:ep.id,status:ep.status,terminal:terminal(ep.status),policyVersionIds:ep.policy_version_ids,participantScores:ep.participant_scores,costUsd:ep.cost_usd??null,replayUrl:safeReplay(ep.replay_url)}));
  return {requestId:result.id,status:result.status,terminal:terminal(result.status),canCancel:result.can_cancel&&!terminal(result.status),episodes,costUsd:episodes.every(ep=>ep.costUsd!==null)?episodes.reduce((sum,ep)=>sum+ep.costUsd!,0):null,estimatedCostCredits:result.cost_preview?.estimated_cost_credits??null};
 }catch{const error=new PracticeApiError(0,'Hosted practice response did not match the admitted account, release, roster or configuration',uncertain);if(rawId.success)error.requestId=rawId.data;throw error;}
}
/** One POST, using the exact saved bytes. Replay only while the same admission remains authorized. */
export async function createPracticeRequest(scope:PracticeScope,input:PracticePlan,signal?:AbortSignal):Promise<PracticeReceipt>{
 const plan=validatePracticePlan(input);
 let identity:unknown;
 try{identity=await request(scope,'/whoami',undefined,signal);}
 catch(error){
  // An identity-read rejection does not reject the saved XP POST, especially
  // when an earlier attempt may already exist under its idempotency key.
  if(error instanceof PracticeApiError)throw new PracticeApiError(0,'Practice identity could not be confirmed');
  throw error;
 }
 if(!identity||typeof identity!=='object'||(identity as Record<string,unknown>).subject_type!=='user'||(identity as Record<string,unknown>).subject_id!==scope.subjectId)throw new PracticeApiError(0,'Practice requires the admitted user identity');
 return verify(scope,plan,await request(scope,'/v2/experience-requests',plan.requestBody,signal),undefined,true);
}
export async function readPracticeRequest(scope:PracticeScope,input:PracticePlan,requestId:string,signal?:AbortSignal):Promise<PracticeReceipt>{
 const plan=validatePracticePlan(input),id=requestIdSchema.parse(requestId);
 return verify(scope,plan,await request(scope,`/v2/experience-requests/${id}`,undefined,signal),id);
}
/** Ownership/readback precedes cancellation of a quarantined or previously known handle. */
export async function cancelPracticeRequest(scope:PracticeScope,input:PracticePlan,requestId:string,signal?:AbortSignal):Promise<PracticeReceipt>{
 const plan=validatePracticePlan(input),id=requestIdSchema.parse(requestId),current=await readPracticeRequest(scope,plan,id,signal);
 if(current.terminal||!current.canCancel)return current;
 return verify(scope,plan,await request(scope,`/v2/experience-requests/${id}/cancel`,'{}',signal),id,true);
}
