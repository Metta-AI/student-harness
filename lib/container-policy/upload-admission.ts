import {reviewedContainerArgs,type ReviewedContainerRequest} from './reviewed';
import {z} from 'zod';
import {db} from '../db';
import {leagueIdSchema} from '../league-catalog';
import {readGameContract} from '../game-contract';
import {ownedContainerRevision} from './store';
import {resolveContainerUploadPlayer} from './upload-api';
import {uploadRowSchema,uploadStore} from './upload';

export const containerUploadAdmissionSchema=z.strictObject({
 buildId:z.uuid(),leagueId:leagueIdSchema,playerId:z.string().min(1),
 name:z.string().trim().min(1).max(64).refine(value=>!value.includes(':')),
});
const completedBuildSchema=z.object({id:z.uuid(),student_id:z.string(),revision_id:z.uuid(),state:z.literal('completed'),cancel_requested_at:z.null(),cleanup_confirmed_at:z.string().min(1)});

/** Trusted server boundary for one completed build. The registration grant comes
 * from the calling action's authorization, never an agent-supplied input flag.
 * Registration may trigger the platform's configured automatic evaluations;
 * league entry remains a separate action. No image or policy is sent here. */
export async function admitContainerUpload(studentId:string,token:string,input:unknown,authorization:{registration:boolean},signal?:AbortSignal,reviewed?:ReviewedContainerRequest){
 const reviewedArgs=reviewedContainerArgs(reviewed);
 const p=containerUploadAdmissionSchema.parse(input);
 const registration=z.boolean().parse(authorization?.registration);
 z.string().min(1).parse(studentId);z.string().min(1).parse(token);signal?.throwIfAborted();
 const player=await resolveContainerUploadPlayer(token,studentId,signal);
 if(player.id!==p.playerId)throw Error('The selected upload player changed; reload the player before uploading');
 const result=await db().from('container_policy_builds').select('id,student_id,revision_id,state,cancel_requested_at,cleanup_confirmed_at').eq('student_id',studentId).eq('id',p.buildId).maybeSingle();
 if(result.error||!result.data)throw Error('Completed container build not found in this account');
 const build=completedBuildSchema.parse(result.data);
 if(build.student_id!==studentId||build.id!==p.buildId)throw Error('Container build scope mismatch');
 const revision=await ownedContainerRevision(studentId,p.leagueId,build.revision_id);
 const contract=await readGameContract(token,p.leagueId,{expectedManifestHash:revision.identity.manifestHash},signal);
 if(contract.coworldId!==revision.coworld_id||contract.runtime!=='platform-hosted')throw Error('The selected game no longer matches this container policy');
 signal?.throwIfAborted();
 // SQL independently checks the completed build, verified retained transfer,
 // account hold and immutable identity, and derives every content hash itself.
 const row=uploadRowSchema.parse(await uploadStore.rpc(reviewed?'container_policy_upload_admit_reviewed':'container_policy_upload_admit',{
  ...reviewedArgs,p_student:studentId,p_build:p.buildId,p_league:p.leagueId,p_player:p.playerId,p_name:p.name,p_register:registration,
 }));
 if(row.student_id!==studentId||row.build_id!==p.buildId||row.league_id!==p.leagueId||row.player_id!==p.playerId||row.policy_name!==p.name||row.registration_authorized!==registration)throw Error('Container upload admission scope mismatch');
 return row;
}
