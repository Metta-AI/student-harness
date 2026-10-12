import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {db,studentToken} from '../db';
import {PolicyArtifactStorage} from '../../workers/policy-build/storage.mjs';
import {createContainerArtifactStorage} from './storage-config';
import {PolicyRegistry} from '../../workers/policy-build/registry.mjs';
import * as upstream from './upload-api';

const sha=z.string().regex(/^[a-f0-9]{64}$/),digest=z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const uploadRowSchema=z.object({id:z.uuid(),student_id:z.string(),build_id:z.uuid(),league_id:z.string(),player_id:z.string(),policy_name:z.string(),registration_authorized:z.boolean(),client_hash:digest,manifest_digest:digest,config_digest:digest,archive_sha256:sha,archive_bytes:z.number().int().positive().max(250_000_000),artifact_storage:z.object({manifestSha256:sha,origin:z.string(),receipts:z.object({archive:z.object({archiveSha256:sha,archiveBytes:z.number().int().positive()}).passthrough()}).passthrough()}).passthrough(),storage_origin:z.string(),storage_bucket:z.string(),state:z.enum(['queued','uploading','image_ready','registering','completed','uncertain','canceled']),image_id:z.string().nullable(),registry_target:z.unknown().nullable(),version_receipt:z.unknown().nullable(),lease_token:z.uuid().nullable(),deadline_at:z.string(),registration_token:z.uuid().nullable().optional()});
export type UploadRow=z.infer<typeof uploadRowSchema>;
export type UploadStore={rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>};
export const uploadStore:UploadStore={async rpc(name,args){
 const r=await db().rpc(name,args);
 if(r.error){
  // Only this fixed, account-scoped SQL diagnostic may cross into chat. Never
  // expose arbitrary database errors, which may embed receipt/credential data.
  const prior=/^Use original registration upload ([0-9a-f-]{36}) for this policy image$/.exec(r.error.message);
  if(prior&&z.uuid().safeParse(prior[1]).success)throw Error(`This policy image already has upload ${prior[1]}. Use container_policy_status with kind=upload and that original ID; do not start another registration.`);
  throw Error('Container upload journal operation failed');
 }
 return r.data;
}};
const api={request:upstream.requestContainerImageUpload,get:upstream.getContainerImage,complete:upstream.completeContainerImageUpload,register:upstream.registerContainerPolicy,lookup:upstream.lookupRegisteredContainerPolicy};
export type UploadPorts={store:UploadStore;token:(student:string)=>Promise<string>;storage:()=>PolicyArtifactStorage;registry:(credentials:upstream.ContainerPushCredentials)=>PolicyRegistry;api:typeof api;temporaryRoot?:string};
const defaults:UploadPorts={store:uploadStore,token:studentToken,storage:()=>createContainerArtifactStorage(process.env),registry:credentials=>new PolicyRegistry(credentials),api};

/** Runs one existing admission. It never creates an upload admission, selects a new
 * identity, builds a container, enters a league, or replays an uncertain registration.
 * Registry writes are recoverable by content digest; policy registration has its own
 * one-send fence because upstream may schedule evaluations after accepting it. */
export async function advanceContainerUpload(studentId:string,uploadId:string,signal?:AbortSignal,ports:UploadPorts=defaults){
 z.uuid().parse(uploadId);
 const claimed=await ports.store.rpc('container_policy_upload_claim',{p_student:studentId,p_id:uploadId});
 if(!claimed||typeof claimed==='object'&&'id' in claimed&&claimed.id===null)return {state:'busy'} as const;
 let row=uploadRowSchema.parse(claimed);const original=structuredClone(row);
 function validate(next:unknown){
  const value=uploadRowSchema.parse(next);
  for(const key of ['id','student_id','build_id','league_id','player_id','policy_name','registration_authorized','client_hash','manifest_digest','config_digest','archive_sha256','archive_bytes','artifact_storage','storage_origin','storage_bucket','deadline_at'] as const){if(!isDeepStrictEqual(value[key],original[key]))throw Error('Container upload admission identity changed');}
  if(value.student_id!==studentId||value.id!==uploadId)throw Error('Container upload account mismatch');
  if(value.artifact_storage.origin!==value.storage_origin||value.artifact_storage.receipts.archive.archiveSha256!==value.archive_sha256||value.artifact_storage.receipts.archive.archiveBytes!==value.archive_bytes)throw Error('Container upload retained archive identity mismatch');return value;
 }
 validate(row);
 if(row.state==='completed'||row.state==='canceled')return {state:row.state,receipt:row.version_receipt};
 const remaining=Date.parse(row.deadline_at)-Date.now();if(!Number.isFinite(remaining)||remaining<=0)return {state:'expired'} as const;
 if(!row.lease_token)throw Error('Container upload lease missing');
 const active=AbortSignal.any([AbortSignal.timeout(Math.min(15*60000,Math.ceil(remaining))),...signal?[signal]:[]]);
 const args={p_student:studentId,p_id:uploadId,p_token:row.lease_token};let directory:string|undefined;let registrationStarted=false;let interrupted=false;
 const record=async(stage:string,value:unknown)=>{row=validate(await ports.store.rpc('container_policy_upload_record',{...args,p_token:stage==='registered'&&row.registration_token?row.registration_token:args.p_token,p_stage:stage,p_value:value}));return row;};
 const authorize=async()=>{active.throwIfAborted();const latest=validate(await ports.store.rpc('container_policy_upload_authorize',args));if(latest.lease_token!==args.p_token)throw Error('Container upload lease changed');row=latest;active.throwIfAborted();};
 const checkpoint={authorize,load:(key:string)=>ports.store.rpc('container_policy_upload_checkpoint',{...args,p_key:key,p_value:null}),save:(key:string,value:unknown)=>ports.store.rpc('container_policy_upload_checkpoint',{...args,p_key:key,p_value:value}),restart:(key:string,location:string)=>ports.store.rpc('container_policy_upload_blob_restart',{...args,p_key:key,p_location:location})};
 const scope:upstream.ContainerUploadScope={token:await ports.token(studentId),subjectId:studentId,playerId:row.player_id,authorize};
 const identity=()=>({imageId:row.image_id!,clientHash:row.client_hash,manifestDigest:row.manifest_digest});
 const versionReceipt=(version:{id:string;name:string;version:number;player_id:string})=>({policyVersionId:version.id,playerId:version.player_id,imageId:row.image_id,name:version.name,version:version.version});
 try{
  if(row.state==='registering'||row.state==='uncertain'){
   // No known ID means no reliable readback. Never use name/latest as proof.
   const receipt=z.object({policyVersionId:z.uuid()}).safeParse(row.version_receipt);
   if(!receipt.success)return {state:'uncertain'} as const;
   const readonlyScope={...scope,authorize:async()=>{active.throwIfAborted();}};
   const observed=await ports.api.lookup(readonlyScope,{id:receipt.data.policyVersionId,name:row.policy_name},active);
   if(!observed)return {state:'uncertain'} as const;
   await record('registered',versionReceipt(observed));return {state:row.state,receipt:row.version_receipt};
  }
  await authorize();
  let image=row.image_id?await ports.api.get(scope,identity(),active):null;
  if(!image||image.status==='pending'){
   await authorize();
   const requested=await ports.api.request(scope,{name:row.policy_name,clientHash:row.client_hash,manifestDigest:row.manifest_digest},active);
   if(row.image_id&&row.image_id!==requested.image.id)throw Error('Original container image changed during credential refresh');
   image=requested.image;
   const credentials=requested.credentials;
   if(credentials){
    const registry=ports.registry(credentials);
    const target={origin:registry.origin,repository:registry.repository,tag:registry.tag};
    if(row.registry_target&&!isDeepStrictEqual(row.registry_target,target))throw Error('Original registry upload target changed');
    await record('image',{imageId:image.id,target});
    const storage=ports.storage();
    if(storage.origin!==row.storage_origin||storage.bucket!==row.storage_bucket)throw Error('Retained storage scope differs from upload admission');
    await authorize();directory=await fs.mkdtemp(path.join(ports.temporaryRoot??os.tmpdir(),'policy-upload-'));await fs.chmod(directory,0o700);
    const archivePath=path.join(directory,'image.tar');
    await storage.restoreArchive({studentId,buildId:row.build_id,receipt:row.artifact_storage.receipts.archive,file:archivePath,signal:active,deadlineAt:row.deadline_at,authorize});
    await authorize();
    // The platform reserves this owned image/target for the exact content hash.
    // Push-only ECR credentials cannot read manifests; the completion endpoint
    // independently resolves the target's actual registry digest server-side.
    let publicationVerified=false;
    const verifyPublication=async()=>{
     await authorize();
     const verified=await ports.api.complete(scope,identity(),active);
     if(!['ready','published'].includes(verified.status)||verified.id!==row.image_id||verified.client_hash!==row.client_hash||verified.image_digest!==row.manifest_digest)throw Error('Owned image publication could not be verified');
     await authorize();image=verified;publicationVerified=true;return {manifestDigest:verified.image_digest};
    };
    const pushed=await registry.push({archivePath,archiveSha256:row.archive_sha256,archiveBytes:row.archive_bytes,manifestDigest:row.manifest_digest,configDigest:row.config_digest,checkpoint,verifyPublication,signal:active});
    await record('registry',{manifestDigest:pushed.manifestDigest,configDigest:pushed.configDigest,archiveSha256:pushed.archiveSha256});
    if(!publicationVerified)image=await ports.api.complete(scope,identity(),active);
   }else await record('image',{imageId:image.id});
  }
  if(!image||!['ready','published'].includes(image.status)||image.id!==row.image_id||image.image_digest!==row.manifest_digest||image.client_hash!==row.client_hash)throw Error('Uploaded image could not be verified');
  await record('image_ready',{imageId:image.id,manifestDigest:row.manifest_digest});
  if(!row.registration_authorized)return {state:row.state,image:{id:image.id,manifestDigest:row.manifest_digest}};
  await authorize();registrationStarted=true;await record('registering',{});
  const registrationToken=row.registration_token??args.p_token;
  const registeringScope={...scope,authorize:async()=>{
   active.throwIfAborted();const allowed=await ports.store.rpc('container_policy_upload_registration_allowed',{p_student:studentId,p_id:uploadId,p_token:registrationToken});if(allowed!==true)throw Error('Container registration authority ended');active.throwIfAborted();
  }};
  const version=await ports.api.register(registeringScope,{name:row.policy_name,...identity()},active);
  await record('registered',versionReceipt(version));return {state:row.state,receipt:row.version_receipt};
 }catch(error){
  interrupted=true;
  if(registrationStarted){
   const returned=error instanceof upstream.ContainerUploadApiError?error.registeredVersion:undefined;
   await record('uncertain',returned?{policyVersionId:returned.id}:{}).catch(()=>{});
   return {state:'uncertain'} as const;
  }
  // Never journal untrusted upstream errors: they may contain registry credentials.
  return {state:'waiting',message:'The original container upload remains recorded for recovery.'} as const;
 }finally{
  if(directory)await fs.rm(directory,{recursive:true,force:true});
  await ports.store.rpc('container_policy_upload_finish',{...args,p_message:registrationStarted?'Registration pass ended':'Upload pass ended',p_error:interrupted}).catch(()=>{});
 }
}
