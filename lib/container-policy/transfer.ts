import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {db} from '../db';
import {ownedContainerRevision} from './store';
import {retainArtifact} from '../../workers/policy-build/artifact.mjs';
import {PolicyArtifactStorage} from '../../workers/policy-build/storage.mjs';

type BuildInput={id:string;leagueId:string;coworldId:string;manifestHash:string;platform:string;dockerfile:string;files:{path:string;content:string}[]};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const transferSchema=z.object({build_id:z.uuid(),student_id:z.string(),manifest_sha256:z.string(),origin:z.string(),bucket:z.string(),lease_token:z.uuid().nullable(),deadline_at:z.string(),completed_at:z.string().nullable(),receipts:z.unknown()});
type Transfer=z.infer<typeof transferSchema>;
export type TransferStore={
 input:(student:string,league:string,build:string)=>Promise<BuildInput>;
 rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>;
};
export const transferStore:TransferStore={
 async input(student,league,id){
  const result=await db().from('container_policy_builds').select('id,student_id,revision_id').eq('student_id',student).eq('id',id).maybeSingle();
  if(result.error)throw Error('Container build could not load');
  if(!result.data||result.data.id!==id||result.data.student_id!==student)throw Error('Container build not found in this account');
  const r=await ownedContainerRevision(student,league,result.data.revision_id);
  return {id,leagueId:r.league_id,coworldId:r.coworld_id,manifestHash:r.identity.manifestHash,platform:'linux/amd64',dockerfile:r.identity.dockerfile,files:r.files};
 },
 async rpc(name,args){const result=await db().rpc(name,args);if(result.error)throw Error(result.error.message);return result.data;},
};

/** Internal controller path. The original source is read from account-owned
 * admission, not the builder's source copy. Complete retention and builder
 * shutdown are distinct durable facts; PostgreSQL joins them into completion.
 * A failed/uncertain transfer is left for a replacement lease, never recreated. */
export async function retainContainerBuild({studentId,leagueId,buildId,receipt,archivePath,directory,storage,signal:outerSignal}: {
 studentId:string;leagueId:string;buildId:string;receipt:unknown;archivePath:string;directory:string;storage:PolicyArtifactStorage;signal?:AbortSignal;
},store:TransferStore=transferStore){
 outerSignal?.throwIfAborted();
 z.uuid().parse(buildId);
 const input=await store.input(studentId,leagueId,buildId);
 if(input.id!==buildId||input.leagueId!==leagueId)throw Error('Artifact admission scope mismatch');
 const signal=AbortSignal.any([AbortSignal.timeout(15*60000),...outerSignal?[outerSignal]:[]]);
 const retained=await retainArtifact({input,receipt,archivePath,directory,signal});
 const manifest=await fs.readFile(path.join(retained.directory,'artifact.json'),'utf8');
 signal.throwIfAborted();
 const claimed=await store.rpc('container_policy_transfer_claim',{p_student:studentId,p_build:buildId,p_manifest:manifest,p_origin:storage.origin,p_bucket:storage.bucket});
 // PostgREST may serialize a null composite as an object with null fields.
 if(claimed===null||(typeof claimed==='object'&&claimed!==null&&'build_id' in claimed&&claimed.build_id===null))return {state:'busy'} as const;
 const lease=transferSchema.parse(claimed);
 function check(row:Transfer){
  if(row.build_id!==buildId||row.student_id!==studentId||row.manifest_sha256!==digest(manifest)||row.origin!==storage.origin||row.bucket!==storage.bucket)throw Error('Artifact transfer scope mismatch');
 }
 check(lease);
 if(lease.completed_at)return {state:'retained',buildId,receipts:lease.receipts} as const;
 if(!lease.lease_token)throw Error('Artifact transfer lease missing');
 const args={p_student:studentId,p_build:buildId,p_token:lease.lease_token};
 const checkpoint={
  async authorize(){
   signal.throwIfAborted();
   const current=transferSchema.parse(await store.rpc('container_policy_transfer_authorize',args));check(current);
   if(current.lease_token!==lease.lease_token||current.completed_at)throw Error('Artifact transfer lease changed');
   signal.throwIfAborted();
  },
  load:(key:string)=>store.rpc('container_policy_transfer_checkpoint',{...args,p_key:key,p_value:null}),
  save:(key:string,value:unknown)=>store.rpc('container_policy_transfer_checkpoint',{...args,p_key:key,p_value:value}),
 };
 // Serial transfer bounds requests and keeps one mutable checkpoint per object.
 const common={studentId,buildId,checkpoint,signal};
 const json=async(name:string,sha256:string)=>{
  const file=path.join(retained.directory,name),stat=await fs.stat(file);
  return storage.retain({...common,name,file,sha256,bytes:stat.size});
 };
 const source=await json('source.json',retained.manifest.sourceFileSha256);
 const buildReceipt=await json('receipt.json',retained.manifest.receiptFileSha256);
 const archive=await storage.retainArchive({...common,file:path.join(retained.directory,'image.tar'),sha256:retained.manifest.archiveSha256,bytes:retained.manifest.archiveBytes});
 const identity=await json('artifact.json',digest(manifest));
 signal.throwIfAborted();
 const complete=transferSchema.parse(await store.rpc('container_policy_transfer_complete',{...args,p_receipts:{source,receipt:buildReceipt,identity,archive}}));check(complete);
 if(!complete.completed_at)throw Error('Artifact transfer completion was not recorded');
 return {state:'retained',buildId,receipts:complete.receipts} as const;
}
