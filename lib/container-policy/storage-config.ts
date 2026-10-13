import {PolicyArtifactStorage} from '../../workers/policy-build/storage.mjs';

/** Archive objects are split into 6 MiB parts. Admitted source is at most
 * 4,000,000 UTF-8 bytes, but source.json may escape each byte as six ASCII bytes
 * (for example U+0001). With up to 256 paths of 240 characters, its serialized
 * size stays below 25 MB. A private 32 MiB object limit covers that source plus
 * metadata; 8 MiB only covered ordinary source and is not a sufficient bound.
 * The full OCI archive remains independently capped at 250,000,000 bytes. */
export const POLICY_ARTIFACT_MAX_OBJECT_BYTES=32*1024*1024;
export const POLICY_ARTIFACT_MIME_TYPES=['application/json','application/octet-stream'] as const;
const projectHost=/^([a-z0-9-]+)(?:\.storage)?\.supabase\.co$/;
function origin(value:string){
 try{
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1')))throw Error();
  return url;
 }catch{throw Error('Invalid private artifact storage configuration');}
}
/** Server-only configuration; key is a service credential and must never be
 * logged or returned to a tool/browser. Supabase's JS SDK uses the API hostname
 * for storage/v1, whereas TUS recommends the project's direct storage hostname:
 * https://supabase.com/docs/guides/storage/uploads/resumable-uploads
 *
 * The optional override pins a trusted deployment origin; canonical hosted
 * projects cannot redirect their credentials to another project. Custom/self-
 * hosted origins are preserved unless explicitly overridden. Never follow a
 * response redirect to choose a credential destination. Existing journal
 * origins remain immutable; pin their original origin when recovering them. */
export function containerArtifactStorageConfiguration(env:NodeJS.ProcessEnv){
 const url=env.SUPABASE_URL??env.NEXT_PUBLIC_SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY??env.SUPABASE_SECRET_KEY,bucket=env.POLICY_ARTIFACT_BUCKET;
 if(!url||!key||!bucket)throw Error('Hosted artifact storage is not configured; requires Supabase service credentials and POLICY_ARTIFACT_BUCKET');
 if(key!==key.trim()||/[\r\n]/.test(key)||!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket))throw Error('Invalid private artifact storage configuration');
 const api=origin(url),project=projectHost.exec(api.hostname);
 let storage:URL;
 if(env.POLICY_ARTIFACT_STORAGE_URL!==undefined){
  storage=origin(env.POLICY_ARTIFACT_STORAGE_URL);
  if(project){
   const target=projectHost.exec(storage.hostname);
   if(!target||target[1]!==project[1]||storage.protocol!==api.protocol||storage.port!==api.port)throw Error('Artifact storage override must belong to the configured Supabase project');
  }
 }else{
  storage=new URL(api.origin);
  if(project)storage.hostname=`${project[1]}.storage.supabase.co`;
 }
 return {apiOrigin:api.origin,storageOrigin:storage.origin,key,bucket,maxObjectBytes:POLICY_ARTIFACT_MAX_OBJECT_BYTES,allowedMimeTypes:[...POLICY_ARTIFACT_MIME_TYPES]};
}
export function createContainerArtifactStorage(env:NodeJS.ProcessEnv,signal?:AbortSignal){
 const configuration=containerArtifactStorageConfiguration(env);
 return new PolicyArtifactStorage({url:configuration.storageOrigin,key:configuration.key,bucket:configuration.bucket,fetch:(input:RequestInfo|URL,init?:RequestInit)=>fetch(input,{...init,redirect:'error',...signal?{signal:AbortSignal.any([signal,...init?.signal?[init.signal]:[]])}:{}})});
}
