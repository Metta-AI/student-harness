import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {runCommand} from './worker.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex');
const digest=/^sha256:[a-f0-9]{64}$/;
const chunkSize=6*1024*1024;
// Distribution registries use both `0-N` and `bytes=0-N`. N is inclusive;
// accept only one complete contiguous range within the admitted blob.
function acknowledgedOffset(value,bytes){
 const range=/^(?:bytes=)?0-([0-9]+)$/.exec(value??'');
 if(!range||range[0]!==value)return null;
 const offset=Number(range[1])+1;
 return Number.isSafeInteger(offset)&&offset>=1&&offset<=bytes?offset:null;
}

/** Controller-side OCI distribution transport. The caller must supply a durable,
 * account-scoped checkpoint lease; this client grants no upload authority. */
export class PolicyRegistry {
 #authorization;
 constructor(info,{fetch:request=fetch}={}){
  const local=info.endpoint_url?.startsWith('http://127.0.0.1:');
  const base=new URL(local?info.endpoint_url:`https://${info.registry}`);
  if(base.username||base.password||base.pathname!=='/'||base.search||base.hash
   ||(!local&&!/^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(base.hostname))
   ||(local&&(base.hostname!=='127.0.0.1'||base.protocol!=='http:'))
   ||info.registry!==base.host||info.endpoint_url&&!local
   ||typeof info.repository!=='string'||!/^([a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(info.repository)
   ||!/^([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})$/.test(info.tag)||!info.tag||info.tag.length>128
   ||info.image_uri!==`${info.registry}/${info.repository}:${info.tag}`
   ||typeof info.authorization_token!=='string'||!info.authorization_token.length||/[\r\n]/.test(info.authorization_token)
   ||!Number.isFinite(Date.parse(info.expires_at)))throw Error('Invalid registry upload target');
  this.origin=base.origin;this.repository=info.repository;this.tag=info.tag;this.expires=Date.parse(info.expires_at);
  this.#authorization='Basic '+info.authorization_token;this.request=request;this.root=`/v2/${this.repository}`;
 }
 async call(url,options,signal){
  if(Date.now()>=this.expires)throw Error('Registry credentials expired; refresh the original upload');
  return this.request(this.origin+url,{...options,headers:{...options.headers,Authorization:this.#authorization},signal:AbortSignal.any([signal,AbortSignal.timeout(45000)]),redirect:'error',cache:'no-store'});
 }
 location(value){
  const url=new URL(value,this.origin);
  if(url.origin!==this.origin||url.username||url.password||url.hash||!url.pathname.startsWith(this.root+'/blobs/uploads/')||url.pathname===this.root+'/blobs/uploads/')throw Error('Untrusted registry upload location');
  return url.pathname+url.search;
 }
 async blobPresent(blob,signal){
  const r=await this.call(this.root+'/blobs/'+blob.digest,{method:'HEAD'},signal);await r.body?.cancel();
  if(r.status===404)return false;
  if(r.status!==200||Number(r.headers.get('content-length'))!==blob.bytes||r.headers.get('docker-content-digest')!==blob.digest)throw Error('Registry blob identity could not be verified');
  return true;
 }
 async push({archivePath,archiveSha256,archiveBytes,manifestDigest,configDigest,checkpoint,verifyPublication,signal:outerSignal}){
  if(!/^[a-f0-9]{64}$/.test(archiveSha256)||!Number.isSafeInteger(archiveBytes)||archiveBytes<1||archiveBytes>250_000_000||!digest.test(manifestDigest)||!digest.test(configDigest)
   ||!checkpoint?.authorize||!checkpoint.load||!checkpoint.save||verifyPublication!==undefined&&typeof verifyPublication!=='function')throw Error('Invalid admitted registry artifact');
  const signal=AbortSignal.any([AbortSignal.timeout(15*60000),...outerSignal?[outerSignal]:[]]);
  // An independently retained private archive is required; verify again before effects.
  const source=await fs.open(archivePath,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const stat=await source.stat();if(!stat.isFile()||stat.size!==archiveBytes)throw Error('Registry archive size mismatch');
   const before=createHash('sha256');for await(const data of source.createReadStream({autoClose:false})){signal.throwIfAborted();before.update(data);}
   if(before.digest('hex')!==archiveSha256)throw Error('Registry archive digest mismatch');
   const inspected=await runCommand('python3',[path.join(process.cwd(),'workers/policy-build/registry_layout.py'),archivePath],{cwd:path.dirname(archivePath),signal,timeoutMs:90000,log:archivePath+'.registry.log'});
   const layout=JSON.parse(inspected.stdout),manifest=Buffer.from(layout.manifest,'base64');
   if(layout.image.manifestDigest!==manifestDigest||layout.image.configDigest!==configDigest||'sha256:'+hash(manifest)!==manifestDigest||layout.mediaType!=='application/vnd.oci.image.manifest.v1+json')throw Error('Registry image differs from retained artifact');
   const identity={origin:this.origin,repository:this.repository,tag:this.tag,archiveSha256,manifestDigest,configDigest};
   const authorize=async()=>{signal.throwIfAborted();await checkpoint.authorize();signal.throwIfAborted();};
   for(const blob of layout.blobs){
    if(!digest.test(blob.digest)||!Number.isSafeInteger(blob.offset)||!Number.isSafeInteger(blob.bytes)||blob.bytes<0||blob.offset<0||blob.offset+blob.bytes>archiveBytes)throw Error('Invalid archive blob layout');
    const key=blob.digest,expected={...identity,digest:blob.digest,bytes:blob.bytes};let state=await checkpoint.load(key);
    if(state&&!isDeepStrictEqual(state.identity,expected))throw Error('Registry checkpoint identity mismatch');
    await authorize();
    if(await this.blobPresent(blob,signal)){await checkpoint.save(key,{identity:expected,phase:'verified',location:state?.location??null});continue;}
    if(state?.phase==='verified')throw Error('Previously verified registry blob is missing');
    let offset=0,fresh=false;
    const createUpload=async()=>{
     state={identity:expected,phase:'creating',location:null};await checkpoint.save(key,state);await authorize();
     const r=await this.call(this.root+'/blobs/uploads/',{method:'POST',headers:{'Content-Length':'0'}},signal);await r.body?.cancel();
     if(r.status!==202||!r.headers.get('location'))throw Error('Registry upload creation is uncertain');
     state={identity:expected,phase:'uploading',location:this.location(r.headers.get('location'))};await checkpoint.save(key,state);fresh=true;
    };
    if(!state)await createUpload();
    if(state.phase!=='uploading'||!state.location)throw Error('Registry upload creation is uncertain; inspect the original operation');
    let location=this.location(state.location);
    if(!fresh){
     const r=await this.call(location,{method:'GET'},signal);await r.body?.cancel();
     if(r.status===404){
      // A missing transfer is not a missing image. Recheck the content digest
      // before spending the journal's one-time replacement-transfer grant.
      await authorize();
      if(await this.blobPresent(blob,signal)){await checkpoint.save(key,{...state,phase:'verified'});continue;}
      if(!checkpoint.restart)throw Error('Original registry upload cannot be resumed');
      await authorize();const restarted=await checkpoint.restart(key,location);
      if(restarted?.can_create!==true||!isDeepStrictEqual(restarted.checkpoint,{identity:expected,phase:'creating',location:null}))throw Error('Registry blob replacement creation remains uncertain');
      await createUpload();location=this.location(state.location);
     }else{
      const acknowledged=acknowledgedOffset(r.headers.get('range'),blob.bytes);
      if(r.status!==204||acknowledged===null)throw Error('Original registry upload cannot be resumed');
      // 0-0 can describe either no bytes or one byte; do not guess and corrupt it.
      if(acknowledged===1)throw Error('Original registry upload offset is ambiguous');
      offset=acknowledged;
      location=this.location(r.headers.get('location')??location);state={...state,location};await checkpoint.save(key,state);
     }
    }
    while(offset<blob.bytes){
     const data=Buffer.alloc(Math.min(chunkSize,blob.bytes-offset));let count=0;
     while(count<data.length){const read=await source.read(data,count,data.length-count,blob.offset+offset+count);if(!read.bytesRead)throw Error('Archive ended during upload');count+=read.bytesRead;}
     await authorize();const r=await this.call(location,{method:'PATCH',headers:{'Content-Type':'application/octet-stream','Content-Length':String(data.length),'Content-Range':`${offset}-${offset+data.length-1}`},body:data},signal);await r.body?.cancel();
     // ECR also acknowledges PATCH with 201. It is only a chunk receipt:
     // require the exact range and a trusted continuation, then still finalize
     // and independently HEAD-verify the complete content digest below.
     if(![201,202].includes(r.status)||r.status===201&&!r.headers.get('location')||acknowledgedOffset(r.headers.get('range'),blob.bytes)!==offset+data.length)throw Error('Registry chunk acknowledgement is uncertain');
     offset+=data.length;location=this.location(r.headers.get('location')??location);state={...state,location};await checkpoint.save(key,state);
    }
    await authorize();const target=new URL(location,this.origin);target.searchParams.set('digest',blob.digest);
    const committed=await this.call(target.pathname+target.search,{method:'PUT',headers:{'Content-Length':'0'}},signal);await committed.body?.cancel();
    if(committed.status!==201||!await this.blobPresent(blob,signal))throw Error('Registry blob completion is uncertain');
    await checkpoint.save(key,{identity:expected,phase:'verified',location});
   }
   const key='manifest',expected={...identity,bytes:manifest.length},prior=await checkpoint.load(key);
   if(prior&&!isDeepStrictEqual(prior.identity,expected))throw Error('Registry manifest checkpoint mismatch');
   const verify=async()=>{
    const r=await this.call(`${this.root}/manifests/${this.tag}`,{method:'GET',headers:{Accept:layout.mediaType}},signal);
    if(r.status===404){await r.body?.cancel();return false;}
    // Scoped ECR push credentials cannot read manifests. Only the owned image
    // pipeline can supply authoritative server-side publication verification.
    if(r.status===403&&verifyPublication){await r.body?.cancel();return null;}
    if(r.status!==200){await r.body?.cancel();throw Error('Registry manifest could not be read');}
    const reader=r.body.getReader();let size=0;const hashValue=createHash('sha256');
    try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>manifest.length)throw Error('Registry manifest identity mismatch');hashValue.update(part.value);}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    if(size!==manifest.length||'sha256:'+hashValue.digest('hex')!==manifestDigest)throw Error('Registry tag belongs to a different image');return true;
   };
   const verifyOwnedPublication=async()=>{
    await authorize();const confirmed=await verifyPublication();await authorize();
    if(confirmed?.manifestDigest!==manifestDigest)throw Error('Original registry manifest publication remains uncertain');
   };
   await authorize();
   const observed=await verify();
   if(!observed){
    if(prior){
     // A previous send may already have committed. Never repeat it, including
     // when the provider refuses read access or the receipt was lost.
     if(!verifyPublication)throw Error('Original registry manifest publication remains uncertain');
     await verifyOwnedPublication();
    }else{
     await checkpoint.save(key,{identity:expected,phase:'publishing'});await authorize();
     let r;
     try{r=await this.call(`${this.root}/manifests/${this.tag}`,{method:'PUT',headers:{'Content-Type':layout.mediaType},body:manifest},signal);await r.body?.cancel();}
     catch(error){if(!verifyPublication)throw error;}
     if(verifyPublication&&(observed===null||r?.status!==201)){
      // Even a 201/digest acknowledgement is followed by the platform's owned
      // image readback. It also resolves lost or rejected PUT acknowledgements.
      await verifyOwnedPublication();
     }else if(r?.status!==201||!await verify())throw Error('Registry manifest publication is uncertain');
    }
   }
   await checkpoint.save(key,{identity:expected,phase:'verified'});
   return {registry:new URL(this.origin).host,repository:this.repository,tag:this.tag,manifestDigest,configDigest,archiveSha256};
  }finally{await source.close();}
 }
}
