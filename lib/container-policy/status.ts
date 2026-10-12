import {z} from 'zod';
import {db} from '../db';

const league=z.string().regex(/^league_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
const timestamp=z.string().refine(value=>Number.isFinite(Date.parse(value)));
const common={id:z.uuid(),student_id:z.string(),state:z.string(),next_at:timestamp.nullable(),deadline_at:timestamp,cancel_requested_at:timestamp.nullable()};
const buildRow=z.object({...common,revision_id:z.uuid(),state:z.enum(['queued','provisioning','building','retaining','stopping','completed','failed','canceled']),cleanup_confirmed_at:timestamp.nullable(),container_policy_revisions:z.object({league_id:league})});
const uploadRow=z.object({...common,build_id:z.uuid(),league_id:league,player_id:z.string().min(1),policy_name:z.string().min(1).max(64),registration_authorized:z.boolean(),state:z.enum(['queued','uploading','image_ready','registering','completed','uncertain','canceled']),image_id:z.string().nullable(),version_receipt:z.unknown().nullable()});
const receiptSchema=z.object({policyVersionId:z.uuid(),playerId:z.string().min(1),imageId:z.string().min(1),name:z.string().min(1).max(64).optional(),version:z.number().int().positive().optional()});
export type ContainerPolicyReceipt={policyVersionId:string;playerId:string;name?:string;version?:number};
export type ContainerBuildStatus={kind:'build';id:string;revisionId:string;leagueId:string;state:z.infer<typeof buildRow>['state'];nextAt:string|null;deadlineAt:string;cancelRequested:boolean;cleanupConfirmed:boolean;outcome:'in_progress'|'artifact_ready'|'cleanup_pending'|'failed'|'canceled'};
export type ContainerUploadStatus={kind:'upload';id:string;buildId:string;leagueId:string;playerId:string;name:string;state:z.infer<typeof uploadRow>['state'];nextAt:string|null;deadlineAt:string;cancelRequested:boolean;registrationAuthorized:boolean;outcome:'in_progress'|'image_uploaded'|'registered'|'uncertain'|'canceled';receipt:ContainerPolicyReceipt|null;unconfirmedPolicyVersionId:string|null};

function scope(studentId:string,leagueId:string,id:string){
 if(!z.string().min(1).max(512).safeParse(studentId).success||!league.safeParse(leagueId).success||!z.uuid().safeParse(id).success)throw Error('Invalid container operation scope');
}
const buildColumns='id,student_id,revision_id,state,next_at,deadline_at,cancel_requested_at,cleanup_confirmed_at,container_policy_revisions!inner(league_id)';
const uploadColumns='id,student_id,build_id,league_id,player_id,policy_name,registration_authorized,state,next_at,deadline_at,cancel_requested_at,image_id,version_receipt';

/** Exact owned read only. Completion refers to retained build artifacts, never
 * uploading, registering a policy, or joining its league. */
export async function ownedContainerBuildStatus(studentId:string,leagueId:string,id:string):Promise<ContainerBuildStatus>{
 scope(studentId,leagueId,id);
 const result=await Promise.resolve().then(()=>db().from('container_policy_builds').select(buildColumns).eq('student_id',studentId).eq('id',id)
  .eq('container_policy_revisions.league_id',leagueId).limit(1).abortSignal(AbortSignal.timeout(10000)).maybeSingle()).catch(()=>{throw Error('Container build status could not load');});
 if(result.error)throw Error('Container build status could not load');
 if(!result.data)throw Error('Container build not found in this account and league');
 const parsed=buildRow.safeParse(result.data);if(!parsed.success)throw Error('Container build status is unavailable');
 const row=parsed.data;
 if(row.id!==id||row.student_id!==studentId||row.container_policy_revisions.league_id!==leagueId)throw Error('Container build scope mismatch');
 const cancelRequested=row.cancel_requested_at!==null,cleanupConfirmed=row.cleanup_confirmed_at!==null;
 const outcome:ContainerBuildStatus['outcome']=cancelRequested||row.state==='canceled'?(cleanupConfirmed?'canceled':'cleanup_pending')
  :row.state==='completed'?(cleanupConfirmed?'artifact_ready':'cleanup_pending')
  :row.state==='failed'?(cleanupConfirmed?'failed':'cleanup_pending'):row.state==='stopping'?'cleanup_pending':'in_progress';
 return {kind:'build',id:row.id,revisionId:row.revision_id,leagueId,state:row.state,nextAt:row.next_at,deadlineAt:row.deadline_at,cancelRequested,cleanupConfirmed,outcome};
}

/** The result deliberately has no source, archive paths, registry credentials,
 * lease tokens or raw provider errors. A returned version ID from an uncertain
 * POST remains explicitly unconfirmed until the scoped readback is recorded. */
export async function ownedContainerUploadStatus(studentId:string,leagueId:string,id:string):Promise<ContainerUploadStatus>{
 scope(studentId,leagueId,id);
 const result=await Promise.resolve().then(()=>db().from('container_policy_uploads').select(uploadColumns).eq('student_id',studentId).eq('league_id',leagueId).eq('id',id)
  .limit(1).abortSignal(AbortSignal.timeout(10000)).maybeSingle()).catch(()=>{throw Error('Container upload status could not load');});
 if(result.error)throw Error('Container upload status could not load');
 if(!result.data)throw Error('Container upload not found in this account and league');
 const parsed=uploadRow.safeParse(result.data);if(!parsed.success)throw Error('Container upload status is unavailable');
 const row=parsed.data;if(row.id!==id||row.student_id!==studentId||row.league_id!==leagueId)throw Error('Container upload scope mismatch');
 const candidate=receiptSchema.safeParse(row.version_receipt);let receipt:ContainerPolicyReceipt|null=null;
 if(row.registration_authorized&&['completed','canceled'].includes(row.state)&&candidate.success&&candidate.data.playerId===row.player_id&&candidate.data.imageId===row.image_id&&(candidate.data.name===undefined||candidate.data.name===row.policy_name)){
  const {policyVersionId,playerId,name,version}=candidate.data;receipt={policyVersionId,playerId,...name===undefined?{}:{name},...version===undefined?{}:{version}};
 }
 let unconfirmedPolicyVersionId:string|null=null;
 const pending=z.object({policyVersionId:z.uuid(),playerId:z.string().optional(),imageId:z.string().optional(),name:z.string().optional()}).safeParse(row.version_receipt);
 if(row.registration_authorized&&!receipt&&pending.success&&(pending.data.playerId===undefined||pending.data.playerId===row.player_id)&&(pending.data.imageId===undefined||pending.data.imageId===row.image_id)&&(pending.data.name===undefined||pending.data.name===row.policy_name))unconfirmedPolicyVersionId=pending.data.policyVersionId;
 const cancelRequested=row.cancel_requested_at!==null;
 const outcome:ContainerUploadStatus['outcome']=cancelRequested||row.state==='canceled'?'canceled'
  :row.state==='registering'||row.state==='uncertain'?'uncertain'
  :row.state==='completed'?(row.registration_authorized?(receipt?'registered':'uncertain'):'image_uploaded')
  :row.state==='image_ready'?'image_uploaded':'in_progress';
 return {kind:'upload',id:row.id,buildId:row.build_id,leagueId,playerId:row.player_id,name:row.policy_name,state:row.state,nextAt:row.next_at,deadlineAt:row.deadline_at,cancelRequested,registrationAuthorized:row.registration_authorized,outcome,receipt,unconfirmedPolicyVersionId};
}

/** Verify the selected league before invoking an account-bound cancellation.
 * Rereading handles completion/Stop races without trusting a raw RPC payload. */
export async function cancelContainerOperation(studentId:string,leagueId:string,kind:'build'|'upload',id:string):Promise<ContainerBuildStatus|ContainerUploadStatus>{
 scope(studentId,leagueId,id);if(kind!=='build'&&kind!=='upload')throw Error('Invalid container operation kind');
 const read=kind==='build'?ownedContainerBuildStatus:ownedContainerUploadStatus;
 await read(studentId,leagueId,id);
 let result;
 try{result=await db().rpc(`container_policy_${kind}_cancel`,{p_student:studentId,p_id:id}).abortSignal(AbortSignal.timeout(10000));}
 catch{throw Error('Container operation cancellation could not be confirmed; check its status');}
 if(result.error)throw Error('Container operation cancellation could not be confirmed; check its status');
 return read(studentId,leagueId,id);
}
