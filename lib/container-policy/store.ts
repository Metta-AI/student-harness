import {reviewedContainerArgs,type ReviewedContainerRequest} from './reviewed';
import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {db} from '../db';
import {readGameContract} from '../game-contract';
import {buildIdentity} from '../../workers/policy-build/worker.mjs';

const league=z.string().length(43).regex(/^league_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
const coworld=z.string().length(40).regex(/^cow_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
const hash=z.string().length(64).regex(/^[0-9a-f]+$/);
const manifest=z.string().length(71).regex(/^sha256:[0-9a-f]+$/);
export const saveContainerRevisionSchema=z.object({
 projectId:z.uuid(),revisionId:z.uuid(),parentId:z.uuid().nullable(),leagueId:league,coworldId:coworld,
 manifestHash:manifest,title:z.string().trim().min(1).max(160),dockerfile:z.string().min(1).max(240),
 files:z.array(z.object({path:z.string().min(1).max(240),content:z.string()}).strict()).min(1).max(256),
}).strict();
const revisionSchema=z.object({id:z.uuid(),project_id:z.uuid(),student_id:z.string(),league_id:league,coworld_id:coworld,parent_id:z.uuid().nullable(),files:saveContainerRevisionSchema.shape.files,identity:z.object({manifestHash:manifest,dockerfile:z.string(),sourceHash:hash,sourceBytes:z.number().int()}).passthrough(),created_at:z.string()});
export type ContainerRevision=z.infer<typeof revisionSchema>;
export const builderIdentitySchema=z.object({workerSha256:hash,inspectorSha256:hash,installSha256:hash}).strict();
const buildSchema=z.object({id:z.uuid(),student_id:z.string(),revision_id:z.uuid(),request_key:z.string(),worker_identity:builderIdentitySchema,
 state:z.enum(['queued','provisioning','building','retaining','stopping','completed','failed','canceled']),provider_name:z.string(),
 provision_token:z.uuid().nullable(),provision_started_at:z.string().nullable(),cancel_requested_at:z.string().nullable(),cleanup_confirmed_at:z.string().nullable(),deadline_at:z.string(),created_at:z.string()});
export type ContainerBuild=z.infer<typeof buildSchema>;
async function rpc(name:string,args:Record<string,unknown>){const result=await db().rpc(name,args);if(result.error)throw Error(result.error.message);return result.data;}
function request(revision:ContainerRevision,id=revision.id){
 return {id,leagueId:revision.league_id,coworldId:revision.coworld_id,manifestHash:revision.identity.manifestHash,platform:'linux/amd64',dockerfile:revision.identity.dockerfile,files:revision.files};
}
function verifyRevision(value:unknown){
 const revision=revisionSchema.parse(value),identity=buildIdentity(request(revision));
 if(!isDeepStrictEqual(identity,revision.identity))throw Error('Saved source identity is inconsistent');
 return revision;
}
export async function ownedContainerRevision(studentId:string,leagueId:string,id:string){
 league.parse(leagueId);z.uuid().parse(id);
 const result=await db().from('container_policy_revisions').select('*').eq('student_id',studentId).eq('league_id',leagueId).eq('id',id).maybeSingle();
 if(result.error)throw Error('Saved container policy could not load');if(!result.data)throw Error('Container policy revision not found in this account and league');
 const revision=verifyRevision(result.data);if(revision.student_id!==studentId||revision.league_id!==leagueId||revision.id!==id)throw Error('Container policy scope mismatch');return revision;
}
export async function saveContainerRevision(studentId:string,token:string,input:unknown){
 const p=saveContainerRevisionSchema.parse(input);
 buildIdentity({id:p.revisionId,leagueId:p.leagueId,coworldId:p.coworldId,manifestHash:p.manifestHash,platform:'linux/amd64',dockerfile:p.dockerfile,files:p.files});
 const contract=await readGameContract(token,p.leagueId,{expectedManifestHash:p.manifestHash});
 if(contract.coworldId!==p.coworldId||contract.runtime!=='platform-hosted')throw Error('This source needs the selected game’s hosted container interface');
 const value=await rpc('container_policy_save',{p_student:studentId,p_project:p.projectId,p_revision:p.revisionId,p_parent:p.parentId,p_league:p.leagueId,p_coworld:p.coworldId,p_manifest:p.manifestHash,p_title:p.title,p_dockerfile:p.dockerfile,p_files:p.files});
 const saved=verifyRevision(value);
 if(saved.student_id!==studentId||saved.project_id!==p.projectId||saved.id!==p.revisionId||saved.league_id!==p.leagueId||saved.coworld_id!==p.coworldId)throw Error('Saved container policy scope mismatch');return saved;
}
/** Internal admission only. Worker identity must be derived from deployment files,
 * never accepted from an agent or browser. No provider call occurs here. */
export async function admitContainerBuild(studentId:string,token:string,leagueId:string,revisionId:string,requestKey:string,workerIdentity:unknown,reviewed?:ReviewedContainerRequest){
 const reviewedArgs=reviewedContainerArgs(reviewed);
 const key=z.string().min(8).max(160).parse(requestKey),worker=builderIdentitySchema.parse(workerIdentity);
 const revision=await ownedContainerRevision(studentId,leagueId,revisionId);
 const contract=await readGameContract(token,leagueId,{expectedManifestHash:revision.identity.manifestHash});
 if(contract.coworldId!==revision.coworld_id||contract.runtime!=='platform-hosted')throw Error('The selected game no longer matches this container policy');
 const build=buildSchema.parse(await rpc(reviewed?'container_policy_build_admit_reviewed':'container_policy_build_admit',{...reviewedArgs,p_student:studentId,p_revision:revisionId,p_key:key,p_worker:worker}));
 if(build.student_id!==studentId||build.revision_id!==revisionId||build.request_key!==key)throw Error('Build admission scope mismatch');
 return {build,request:request(revision,build.id)};
}
export async function claimContainerBuild(studentId:string,id:string){
 z.uuid().parse(id);return z.object({build:buildSchema,createProvider:z.boolean()}).parse(await rpc('container_policy_build_claim',{p_student:studentId,p_id:id}));
}
export async function cancelContainerBuild(studentId:string,id:string){
 z.uuid().parse(id);return buildSchema.parse(await rpc('container_policy_build_cancel',{p_student:studentId,p_id:id}));
}
