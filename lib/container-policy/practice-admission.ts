import {reviewedContainerArgs,type ReviewedContainerRequest} from './reviewed';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {db} from '../db';
import {leagueIdSchema} from '../league-catalog';
import {ownedContainerRevision} from './store';
import {lookupRegisteredContainerPolicy} from './upload-api';
import {readPracticePlan} from './practice-plan';
import {practiceRowSchema,practiceStore} from './practice';

export const containerPracticeAdmissionSchema=z.strictObject({
 uploadId:z.uuid(),leagueId:leagueIdSchema,variantId:z.string().min(1).max(160),requestKey:z.string().min(8).max(160),
});
const uploadSchema=z.object({id:z.uuid(),student_id:z.string(),build_id:z.uuid(),league_id:leagueIdSchema,player_id:z.string().min(1),policy_name:z.string(),state:z.literal('completed'),registration_authorized:z.literal(true),cancel_requested_at:z.null(),image_id:z.string().min(1),version_receipt:z.object({policyVersionId:z.uuid(),playerId:z.string(),imageId:z.string(),name:z.string().optional(),version:z.number().int().positive().optional()})});
const buildSchema=z.object({id:z.uuid(),student_id:z.string(),revision_id:z.uuid(),state:z.literal('completed'),cancel_requested_at:z.null(),cleanup_confirmed_at:z.string().min(1)});

/** One explicit hosted-practice grant. Admission records an immutable request;
 * only its background controller can send it. Repeating the caller key returns
 * that original operation, including after cancellation or a game release change. */
export async function admitContainerPractice(studentId:string,token:string,input:unknown,signal?:AbortSignal,reviewed?:ReviewedContainerRequest){
 const reviewedArgs=reviewedContainerArgs(reviewed);
 const p=containerPracticeAdmissionSchema.parse(input);
 z.string().min(1).max(512).parse(studentId);z.string().min(1).parse(token);
 const active=AbortSignal.any([AbortSignal.timeout(60000),...signal?[signal]:[]]);active.throwIfAborted();
 const prior=await db().from('container_policy_practices').select('*').eq('student_id',studentId).eq('request_key',p.requestKey).abortSignal(active).maybeSingle();
 if(prior.error)throw Error('Hosted practice journal is unavailable');
 const scoped=(value:unknown)=>{
  const row=practiceRowSchema.parse(value);
  if(row.student_id!==studentId||row.league_id!==p.leagueId||row.upload_id!==p.uploadId||row.request_key!==p.requestKey||row.plan.variantId!==p.variantId)throw Error('Practice request key belongs to another operation; keep its original identity');
  return row;
 };
 if(prior.data)return scoped(prior.data);
 const uploaded=await db().from('container_policy_uploads').select('id,student_id,build_id,league_id,player_id,policy_name,state,registration_authorized,cancel_requested_at,image_id,version_receipt').eq('student_id',studentId).eq('league_id',p.leagueId).eq('id',p.uploadId).abortSignal(active).maybeSingle();
 if(uploaded.error||!uploaded.data)throw Error('Verified container upload not found in this account and league');
 const upload=uploadSchema.parse(uploaded.data),receipt=upload.version_receipt;
 if(upload.id!==p.uploadId||upload.student_id!==studentId||upload.league_id!==p.leagueId||receipt.playerId!==upload.player_id||receipt.imageId!==upload.image_id||(receipt.name!==undefined&&receipt.name!==upload.policy_name))throw Error('Container policy registration identity is inconsistent');
 const built=await db().from('container_policy_builds').select('id,student_id,revision_id,state,cancel_requested_at,cleanup_confirmed_at').eq('student_id',studentId).eq('id',upload.build_id).abortSignal(active).maybeSingle();
 if(built.error||!built.data)throw Error('Completed practice build not found');
 const build=buildSchema.parse(built.data);
 if(build.id!==upload.build_id||build.student_id!==studentId)throw Error('Practice build identity is inconsistent');
 const revision=await ownedContainerRevision(studentId,p.leagueId,build.revision_id);
 const verified=await lookupRegisteredContainerPolicy({token,subjectId:studentId,playerId:upload.player_id},{id:receipt.policyVersionId,name:upload.policy_name,...receipt.version===undefined?{}:{version:receipt.version}},active);
 if(!verified)throw Error('The uploaded policy version is no longer verified for this player');
 const idempotencyKey='container-practice:'+createHash('sha256').update(studentId+'\n'+p.requestKey).digest('hex');
 const plan=await readPracticePlan(token,p.leagueId,{policyVersionId:receipt.policyVersionId,variantId:p.variantId,idempotencyKey,expectedManifestHash:revision.identity.manifestHash},active);
 if(plan.coworldId!==revision.coworld_id||plan.manifestHash!==revision.identity.manifestHash||plan.policyVersionId!==receipt.policyVersionId||plan.leagueId!==p.leagueId)throw Error('Practice plan differs from the uploaded source release');
 active.throwIfAborted();
 return scoped(await practiceStore.rpc(reviewed?'container_policy_practice_admit_reviewed':'container_policy_practice_admit',{...reviewedArgs,p_student:studentId,p_upload:p.uploadId,p_league:p.leagueId,p_key:p.requestKey,p_plan:plan,p_body:plan.requestBody}));
}
