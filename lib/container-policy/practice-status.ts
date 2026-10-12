import {z} from 'zod';
import {db} from '../db';
import {leagueIdSchema} from '../league-catalog';

const timestamp=z.string().refine(value=>Number.isFinite(Date.parse(value)));
const xp=z.string().regex(/^xreq_[a-zA-Z0-9_-]{8,100}$/);
const resultSchema=z.object({requestId:xp,status:z.enum(['pending','submitted','running','completed','failed','cancelled']),terminal:z.boolean(),episodes:z.array(z.object({id:z.string().regex(/^ereq_[a-zA-Z0-9_-]{8,100}$/),status:z.string(),terminal:z.boolean(),participantScores:z.array(z.object({position:z.number().int().min(0).max(31),score:z.number().finite()})).max(32),costUsd:z.number().nonnegative().nullable(),replayUrl:z.string().nullable()})).max(1),costUsd:z.number().nonnegative().nullable()});
const rowSchema=z.object({id:z.uuid(),student_id:z.string(),league_id:leagueIdSchema,upload_id:z.uuid(),build_id:z.uuid(),revision_id:z.uuid(),player_id:z.string(),policy_version_id:z.uuid(),state:z.enum(['queued','submitting','running','uncertain','completed','failed','canceled','expired']),next_at:timestamp.nullable(),deadline_at:timestamp,reconcile_until:timestamp,cancel_requested_at:timestamp.nullable(),xp_request_id:xp.nullable(),result:z.unknown().nullable(),cost_usd:z.number().nonnegative().nullable(),plan:z.object({variantId:z.string(),seatCount:z.number().int().min(1).max(32),coworldId:z.string(),manifestHash:z.string(),gameVersion:z.string()})});
export type ContainerPracticeStatus={kind:'practice';id:string;leagueId:string;buildId:string;revisionId:string;uploadId:string;playerId:string;policyVersionId:string;state:z.infer<typeof rowSchema>['state'];nextAt:string|null;deadlineAt:string;reconcileUntil:string;cancelRequested:boolean;requestId:string|null;variantId:string;seatCount:number;coworldId:string;manifestHash:string;gameVersion:string;costUsd:number|null;result:z.infer<typeof resultSchema>|null;outcome:'in_progress'|'completed'|'failed'|'uncertain'|'canceled'|'cleanup_pending'|'expired'};
export async function ownedContainerPracticeStatus(studentId:string,leagueId:string,id:string):Promise<ContainerPracticeStatus>{
 z.string().min(1).max(512).parse(studentId);leagueIdSchema.parse(leagueId);z.uuid().parse(id);
 const response=await Promise.resolve().then(()=>db().from('container_policy_practices').select('id,student_id,league_id,upload_id,build_id,revision_id,player_id,policy_version_id,state,next_at,deadline_at,reconcile_until,cancel_requested_at,xp_request_id,result,cost_usd,plan')
  .eq('student_id',studentId).eq('league_id',leagueId).eq('id',id).limit(1).abortSignal(AbortSignal.timeout(10000)).maybeSingle()).catch(()=>{throw Error('Container practice status could not load');});
 if(response.error)throw Error('Container practice status could not load');
 if(!response.data)throw Error('Container practice not found in this account and league');
 const parsed=rowSchema.safeParse(response.data);if(!parsed.success)throw Error('Container practice status is unavailable');
 const row=parsed.data;if(row.id!==id||row.student_id!==studentId||row.league_id!==leagueId)throw Error('Container practice scope mismatch');
 const receipt=resultSchema.safeParse(row.result);let result:ContainerPracticeStatus['result']=receipt.success&&receipt.data.requestId===row.xp_request_id?receipt.data:null;
 if(result){
  const terminal=['completed','failed','cancelled'].includes(result.status);
  if(result.terminal!==terminal||result.episodes.some(ep=>ep.participantScores.some(s=>s.position>=row.plan.seatCount)))result=null;
  else result={...result,episodes:result.episodes.map(ep=>{let replayUrl:string|null=null;try{const u=new URL(ep.replayUrl??'');if(u.protocol==='https:'&&!u.username&&!u.password)replayUrl=u.href;}catch{}return {...ep,replayUrl};})};
 }
 const stopped=row.cancel_requested_at!==null||['canceled','expired'].includes(row.state);
 const outcome:ContainerPracticeStatus['outcome']=stopped?(result?.terminal?'canceled':row.xp_request_id?'cleanup_pending':row.state==='uncertain'?'uncertain':row.state==='expired'?'expired':'canceled')
  :row.state==='uncertain'?'uncertain':row.state==='completed'?(result?.terminal&&result.status==='completed'?'completed':'uncertain'):row.state==='failed'?'failed':'in_progress';
 return {kind:'practice',id,leagueId,buildId:row.build_id,revisionId:row.revision_id,uploadId:row.upload_id,playerId:row.player_id,policyVersionId:row.policy_version_id,state:row.state,nextAt:row.next_at,deadlineAt:row.deadline_at,reconcileUntil:row.reconcile_until,cancelRequested:row.cancel_requested_at!==null,requestId:row.xp_request_id,variantId:row.plan.variantId,seatCount:row.plan.seatCount,coworldId:row.plan.coworldId,manifestHash:row.plan.manifestHash,gameVersion:row.plan.gameVersion,costUsd:row.cost_usd,result,outcome};
}
export async function cancelContainerPractice(studentId:string,leagueId:string,id:string){
 await ownedContainerPracticeStatus(studentId,leagueId,id);
 try{const result=await db().rpc('container_policy_practice_cancel',{p_student:studentId,p_id:id}).abortSignal(AbortSignal.timeout(10000));if(result.error)throw Error();}
 catch{throw Error('Container operation cancellation could not be confirmed; check its status');}
 return ownedContainerPracticeStatus(studentId,leagueId,id);
}
