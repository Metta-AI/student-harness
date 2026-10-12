import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import os from 'node:os';
import path from 'node:path';

const hash=value=>createHash('sha256').update(value).digest('hex');
const chunkBytes=6*1024*1024;
const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const fingerprint=/^[0-9a-f]{64}$/;
const integer=value=>/^(0|[1-9][0-9]*)$/.test(value??'')?Number(value):NaN;

/** Account identity comes from the controller, never a browser's storage path. */
export function artifactObjectKey(studentId,buildId,name,digest){
 if(typeof studentId!=='string'||!studentId.length||studentId.length>500||typeof buildId!=='string'||buildId.length!==36||!uuid.test(buildId)
 ||!['source.json','receipt.json','image.tar','artifact.json','image.tar.parts.json'].includes(name)&&!/^image\.tar\.part-[0-9]{4}$/.test(name)||typeof digest!=='string'||digest.length!==64||!fingerprint.test(digest))throw Error('Invalid artifact object identity');
 return `accounts/${hash(studentId)}/builds/${buildId}/${digest}/${name}`;
}

/** Supabase TUS transport. No automatic retries, overwrite, public URL, or
 * credential forwarding. The owner persists checkpoints under a single lease. */
export class PolicyArtifactStorage {
 constructor({url,key,bucket,fetch:request=fetch}){
  const base=new URL(url);
  if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||(base.protocol!=='https:'&&!(base.protocol==='http:'&&base.hostname==='127.0.0.1'))||!key||!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket))throw Error('Invalid private artifact storage configuration');
  this.origin=base.origin;this.bucket=bucket;this.request=request;this.headers={apikey:key,Authorization:`Bearer ${key}`};
 }
 async call(path,options,signal){
  return this.request(this.origin+path,{...options,headers:{...this.headers,...options.headers},signal:AbortSignal.any([signal,AbortSignal.timeout(45000)]),redirect:'error',cache:'no-store'});
 }
 uploadPath(value){
  const url=new URL(value,this.origin);
  if(url.origin!==this.origin||url.username||url.password||url.search||url.hash||!url.pathname.startsWith('/storage/v1/upload/resumable/'))throw Error('Untrusted upload location');
  return url.pathname;
 }
 objectPath(key){
  if(!/^accounts\/[a-f0-9]{64}\/builds\/[a-f0-9-]{36}\/[a-f0-9]{64}\/(source\.json|receipt\.json|image\.tar|artifact\.json|image\.tar\.parts\.json|image\.tar\.part-[0-9]{4})$/.test(key))throw Error('Invalid artifact key');
  return `/storage/v1/object/authenticated/${this.bucket}/${key}`;
 }
 async checkPrivate(signal){
  const response=await this.call(`/storage/v1/bucket/${this.bucket}`,{method:'GET'},signal);
  if(!response.ok){await response.body?.cancel();throw Error('Private artifact bucket is unavailable');}
  const bytes=await boundedBody(response,16000),bucket=JSON.parse(bytes.toString());
  if(bucket.id!==this.bucket||bucket.public!==false)throw Error('Artifact storage must use the configured private bucket');
 }
 async verify(object,signal){
  const response=await this.call(this.objectPath(object.key),{method:'GET'},signal);
  if(!response.ok){
   // Supabase's object API also uses 400 with a NoSuchKey/not_found payload.
   const body=await boundedBody(response,16000);let error;try{error=JSON.parse(body);}catch{}
   if(response.status===404||response.status===400&&['NoSuchKey','not_found'].includes(error?.code))return false;
   throw Error(`Artifact read failed (${response.status})`);
  }
  const digest=createHash('sha256');let bytes=0;
  const reader=response.body?.getReader();if(!reader)throw Error('Artifact read has no body');
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>object.bytes)throw Error('Stored artifact exceeds its declared size');digest.update(part.value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(bytes!==object.bytes||digest.digest('hex')!==object.sha256)throw Error('Stored artifact digest mismatch');return true;
 }
 /** Resume the exact URL after an uncertain PATCH by reading its server offset.
  * If creation loses its Location response, keep uncertainty; never create a
  * second upload implicitly. The empty TUS resource has the provider's expiry. */
 async retain({studentId,buildId,name,file,sha256,bytes,checkpoint,signal:outerSignal}){
  if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>250_000_000)throw Error('Invalid artifact size');
  const key=artifactObjectKey(studentId,buildId,name,sha256),object={bucket:this.bucket,key,sha256,bytes};
  const identity={origin:this.origin,...object},signal=AbortSignal.any([AbortSignal.timeout(8*60000),...outerSignal?[outerSignal]:[]]);
  const source=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const stat=await source.stat();if(!stat.isFile()||stat.size!==bytes)throw Error('Local artifact size mismatch');
   const digest=createHash('sha256');for await(const data of source.createReadStream({autoClose:false})){signal.throwIfAborted();digest.update(data);}
   if(digest.digest('hex')!==sha256)throw Error('Local artifact digest mismatch');
   await this.checkPrivate(signal);
   let state=await checkpoint.load(key);
   if(state&&!isDeepStrictEqual(state.identity,identity))throw Error('Artifact checkpoint identity mismatch');
   if(await this.verify(object,signal)){
    await checkpoint.save(key,{identity,phase:'verified',uploadPath:state?.uploadPath??null});return object;
   }
   if(state?.phase==='verified')throw Error('Previously verified artifact is missing');
   if(!state){
    state={identity,phase:'creating',uploadPath:null};await checkpoint.save(key,state);
    const metadata={bucketName:this.bucket,objectName:key,contentType:name.endsWith('.json')?'application/json':'application/octet-stream',cacheControl:'0'};
    await checkpoint.authorize?.();signal.throwIfAborted();
    const response=await this.call('/storage/v1/upload/resumable',{method:'POST',headers:{'Tus-Resumable':'1.0.0','Upload-Length':String(bytes),'Upload-Metadata':Object.entries(metadata).map(([k,v])=>`${k} ${Buffer.from(v).toString('base64')}`).join(','),'x-upsert':'false'}},signal);
    await response.body?.cancel();if(response.status!==201)throw Error(`Artifact upload creation is uncertain (${response.status})`);
    const location=response.headers.get('location');if(!location)throw Error('Artifact upload location is missing');
    state={identity,phase:'uploading',uploadPath:this.uploadPath(location)};await checkpoint.save(key,state);
   }
   if(state.phase!=='uploading'||!state.uploadPath)throw Error('Artifact upload creation is uncertain; inspect the original checkpoint');
   const upload=this.uploadPath(state.uploadPath);
   const head=await this.call(upload,{method:'HEAD',headers:{'Tus-Resumable':'1.0.0'}},signal);await head.body?.cancel();
   if(!head.ok)throw Error(`Original artifact upload cannot be resumed (${head.status})`);
   let offset=integer(head.headers.get('upload-offset'));const length=integer(head.headers.get('upload-length'));
   if(length!==bytes||!Number.isSafeInteger(offset)||offset<0||offset>bytes)throw Error('Invalid artifact upload offset');
   while(offset<bytes){
    const buffer=Buffer.alloc(Math.min(chunkBytes,bytes-offset));let read=0;
    while(read<buffer.length){const part=await source.read(buffer,read,buffer.length-read,offset+read);if(!part.bytesRead)throw Error('Local artifact ended early');read+=part.bytesRead;}
    await checkpoint.authorize?.();signal.throwIfAborted();
    const response=await this.call(upload,{method:'PATCH',headers:{'Tus-Resumable':'1.0.0','Upload-Offset':String(offset),'Content-Type':'application/offset+octet-stream','x-upsert':'false'},body:buffer},signal);
    await response.body?.cancel();if(response.status!==204||integer(response.headers.get('upload-offset'))!==offset+read)throw Error('Artifact chunk acknowledgement is uncertain; resume the original upload');
    offset+=read;
   }
   if(!await this.verify(object,signal))throw Error('Completed artifact is not yet visible; verify the original object on recovery');
   await checkpoint.save(key,{identity,phase:'verified',uploadPath:upload});return object;
  }finally{await source.close();}
 }
 /** Small immutable parts keep large OCI archives within project object limits.
  * The index is published only after every part verifies, and its reconstruction
  * is independently hashed before returning a durable storage receipt. */
 async retainArchive({studentId,buildId,file,sha256,bytes,checkpoint,signal:outerSignal}){
  artifactObjectKey(studentId,buildId,'image.tar',sha256);
  if(!Number.isSafeInteger(bytes)||bytes<1||bytes>250_000_000)throw Error('Invalid archive size');
  const signal=AbortSignal.any([AbortSignal.timeout(10*60000),...outerSignal?[outerSignal]:[]]);
  const source=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW),directory=await fs.mkdtemp(path.join(os.tmpdir(),'policy-parts-'));
  try{
   const stat=await source.stat();if(!stat.isFile()||stat.size!==bytes)throw Error('Local archive size mismatch');
   const before=createHash('sha256');for await(const data of source.createReadStream({autoClose:false})){signal.throwIfAborted();before.update(data);}
   if(before.digest('hex')!==sha256)throw Error('Local archive digest mismatch');
   const parts=[];
   for(let offset=0;offset<bytes;offset+=chunkBytes){
    const data=Buffer.alloc(Math.min(chunkBytes,bytes-offset));let read=0;
    while(read<data.length){const r=await source.read(data,read,data.length-read,offset+read);if(!r.bytesRead)throw Error('Local archive ended early');read+=r.bytesRead;}
    const name=`image.tar.part-${String(parts.length).padStart(4,'0')}`,partFile=path.join(directory,'part');
    await fs.writeFile(partFile,data,{mode:0o600});
    parts.push(await this.retain({studentId,buildId,name,file:partFile,sha256:hash(data),bytes:data.length,checkpoint,signal}));
   }
   const layout={format:'oci-archive-parts/1',archiveSha256:sha256,archiveBytes:bytes,parts};
   const index=Buffer.from(JSON.stringify(layout)+'\n'),indexFile=path.join(directory,'index.json');await fs.writeFile(indexFile,index,{mode:0o600});
   const object=await this.retain({studentId,buildId,name:'image.tar.parts.json',file:indexFile,sha256:hash(index),bytes:index.length,checkpoint,signal});
   const receipt={...object,...layout};await this.verifyArchive({studentId,buildId,receipt,signal,authorize:checkpoint.authorize});return receipt;
  }finally{await source.close();await fs.rm(directory,{recursive:true,force:true});}
 }
 async verifyArchive({studentId,buildId,receipt,signal:outerSignal,authorize}){
  const signal=AbortSignal.any([AbortSignal.timeout(5*60000),...outerSignal?[outerSignal]:[]]);
  return this.#readArchive({studentId,buildId,receipt,signal,authorize});
 }
 /** Restore the exact retained archive after the builder has been deleted.
  * The destination must be in a controller-owned private directory. Never reuse
  * a partial file: create it exclusively and remove our inode on any failure.
  * At most one immutable part (6 MiB) is buffered; no OCI extraction occurs. */
 async restoreArchive({studentId,buildId,receipt,file,signal:outerSignal,deadlineAt,authorize}){
  const remaining=deadlineAt===undefined?5*60000:new Date(deadlineAt).getTime()-Date.now();
  if(!Number.isFinite(remaining)||remaining<=0)throw Error('Archive restore deadline has expired or is invalid');
  const signal=AbortSignal.any([AbortSignal.timeout(Math.min(5*60000,Math.ceil(remaining))),...outerSignal?[outerSignal]:[]]);
  // Freeze the admitted receipt before yielding to a lease callback or network.
  receipt=structuredClone(receipt);
  signal.throwIfAborted();await authorize?.();signal.throwIfAborted();
  const output=await fs.open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  const identity=await output.stat();let complete=false;
  try{
   const result=await this.#readArchive({studentId,buildId,receipt,signal,authorize},async bytes=>{
    signal.throwIfAborted();await output.writeFile(bytes);signal.throwIfAborted();
   });
   await authorize?.();signal.throwIfAborted();await output.sync();signal.throwIfAborted();
   const current=await fs.lstat(file);
   if(current.dev!==identity.dev||current.ino!==identity.ino)throw Error('Archive restore destination changed');
   await output.close();complete=true;
   return {file,...result};
  }finally{
   if(!complete){
    await output.close().catch(()=>{});
    const current=await fs.lstat(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
    if(current?.dev===identity.dev&&current?.ino===identity.ino)await fs.unlink(file);
   }
  }
 }
 async #readArchive({studentId,buildId,receipt,signal,authorize},consume){
  if(!receipt||receipt.format!=='oci-archive-parts/1'||receipt.bucket!==this.bucket||receipt.key!==artifactObjectKey(studentId,buildId,'image.tar.parts.json',receipt.sha256)||!Number.isSafeInteger(receipt.archiveBytes)||receipt.archiveBytes<1||receipt.archiveBytes>250_000_000||!Array.isArray(receipt.parts)||receipt.parts.length!==Math.ceil(receipt.archiveBytes/chunkBytes))throw Error('Invalid archive storage receipt');
  await this.checkPrivate(signal);
  await authorize?.();signal.throwIfAborted();
  const indexResponse=await this.call(this.objectPath(receipt.key),{method:'GET'},signal);if(!indexResponse.ok){await indexResponse.body?.cancel();throw Error('Archive index is unavailable');}
  const index=await boundedBody(indexResponse,64000);
  const layout={format:receipt.format,archiveSha256:receipt.archiveSha256,archiveBytes:receipt.archiveBytes,parts:receipt.parts};
  if(index.length!==receipt.bytes||hash(index)!==receipt.sha256||!isDeepStrictEqual(JSON.parse(index.toString()),layout))throw Error('Archive index identity mismatch');
  const archive=createHash('sha256');let total=0;
  for(const [i,part] of receipt.parts.entries()){
   const expected=Math.min(chunkBytes,receipt.archiveBytes-i*chunkBytes);
   if(part.bucket!==this.bucket||part.bytes!==expected||part.key!==artifactObjectKey(studentId,buildId,`image.tar.part-${String(i).padStart(4,'0')}`,part.sha256))throw Error('Archive part scope mismatch');
   await authorize?.();signal.throwIfAborted();
   const response=await this.call(this.objectPath(part.key),{method:'GET'},signal);if(!response.ok){await response.body?.cancel();throw Error('Archive part is unavailable');}
   const bytes=await boundedBody(response,expected);if(bytes.length!==expected||hash(bytes)!==part.sha256)throw Error('Archive part digest mismatch');archive.update(bytes);total+=bytes.length;await consume?.(bytes);
  }
  if(total!==receipt.archiveBytes||archive.digest('hex')!==receipt.archiveSha256)throw Error('Reconstructed archive identity mismatch');
  return {sha256:receipt.archiveSha256,bytes:total};
 }
}
async function boundedBody(response,limit){
 const chunks=[];let size=0;const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit)throw Error('Storage metadata exceeds its limit');chunks.push(part.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return Buffer.concat(chunks);
}
