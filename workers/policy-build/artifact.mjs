import fs from 'node:fs/promises';
import {constants,createReadStream,createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {buildIdentity,runCommand} from './worker.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const hashPattern=/^[0-9a-f]{64}$/;
const imageFields=['manifestDigest','configDigest','platform','layers','imageBytes','entrypoint','command'];
const encode=value=>JSON.stringify(value,null,2)+'\n';

function checkReceipt(input,receipt,maxBytes){
 const identity=buildIdentity(input);
 if(!receipt||receipt.id!==input.id||receipt.status!=='completed')throw Error('A completed receipt for the admitted build is required');
 for(const [key,value] of Object.entries(identity))if(!isDeepStrictEqual(receipt[key],value))throw Error('Build receipt does not match admitted source and release');
 const image=receipt.image;
 if(!image||image.archive!=='image.tar'||image.reference!==`preston-policy:${input.id}`||typeof image.archiveSha256!=='string'||image.archiveSha256.length!==64||!hashPattern.test(image.archiveSha256)||!Number.isSafeInteger(image.archiveBytes)||image.archiveBytes<=0||image.archiveBytes>maxBytes)throw Error('Invalid or oversized policy artifact');
 if(receipt.metadata?.['containerimage.digest']!==image.manifestDigest||receipt.metadata?.['containerimage.config.digest']!==image.configDigest)throw Error('Build metadata does not match the image receipt');
 return identity;
}

/**
 * Retain a verified bundle outside a disposable builder. The caller supplies an
 * account-owned directory and the original admitted input, never a worker's copy
 * of that input. This function does not confer authorization or upload a policy.
 */
export async function retainArtifact({input,receipt,archivePath,directory,signal,maxArchiveBytes=250_000_000}){
 if(!path.isAbsolute(directory)||!path.isAbsolute(archivePath))throw Error('Absolute artifact paths are required');
 if(!Number.isSafeInteger(maxArchiveBytes)||maxArchiveBytes<1||maxArchiveBytes>2_000_000_000)throw Error('Invalid artifact size limit');
 // Snapshot caller-owned objects before awaiting; later mutations cannot change
 // the source evidence after validation.
 input=structuredClone(input);receipt=structuredClone(receipt);
 const identity=checkReceipt(input,receipt,maxArchiveBytes);
 const deadline=AbortSignal.any([AbortSignal.timeout(120000),...signal?[signal]:[]]);deadline.throwIfAborted();
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 const staging=await fs.mkdtemp(path.join(directory,'.receiving-'));
 const destination=path.join(directory,input.id);
 try{
  const source=await fs.open(archivePath,constants.O_RDONLY|constants.O_NOFOLLOW);
  const digest=createHash('sha256');let bytes=0;
  try{
   const stat=await source.stat();if(!stat.isFile()||stat.size!==receipt.image.archiveBytes)throw Error('Policy archive size mismatch');
   const counter=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;if(bytes>maxArchiveBytes||bytes>receipt.image.archiveBytes){done(Error('Policy archive exceeds its declared size'));return;}digest.update(chunk);done(null,chunk);}});
   await pipeline(source.createReadStream({autoClose:false}),counter,createWriteStream(path.join(staging,'image.tar'),{flags:'wx',mode:0o600}),{signal:deadline});
  }finally{await source.close();}
  const archiveSha256=digest.digest('hex');
  if(bytes!==receipt.image.archiveBytes||archiveSha256!==receipt.image.archiveSha256)throw Error('Policy archive digest mismatch');
  // Inspect the private staged copy, not a mutable download path or worker claim.
  const inspected=await runCommand('python3',[path.join(process.cwd(),'workers/policy-build/inspect_oci.py'),path.join(staging,'image.tar')],{cwd:staging,signal:deadline,timeoutMs:90000,log:path.join(staging,'inspection.log')});
  const image=JSON.parse(inspected.stdout);
  for(const key of imageFields)if(!isDeepStrictEqual(image[key],receipt.image[key]))throw Error('Independent OCI inspection does not match the build receipt');
  const sourceText=encode(input),receiptText=encode(receipt);
  const manifest={version:1,id:input.id,leagueId:identity.leagueId,coworldId:identity.coworldId,manifestHash:identity.manifestHash,sourceHash:identity.sourceHash,
   sourceFileSha256:sha(sourceText),receiptFileSha256:sha(receiptText),archiveSha256,archiveBytes:bytes,image};
  const manifestText=encode(manifest);
  await fs.writeFile(path.join(staging,'source.json'),sourceText,{mode:0o600});
  await fs.writeFile(path.join(staging,'receipt.json'),receiptText,{mode:0o600});
  await fs.writeFile(path.join(staging,'artifact.json'),manifestText,{mode:0o600});
  await fs.unlink(path.join(staging,'inspection.log'));
  deadline.throwIfAborted();
  try{await fs.rename(staging,destination);}
  catch(error){
   if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error;
   // Atomic publication may race another identical delivery. Never overwrite
   // another build or accept a damaged previously retained bundle.
   for(const [file,expected] of [['source.json',sourceText],['receipt.json',receiptText],['artifact.json',manifestText]])if(await fs.readFile(path.join(destination,file),'utf8')!==expected)throw Error('Retained build identity conflict');
   const retained=createHash('sha256');let retainedBytes=0;
   for await(const chunk of createReadStream(path.join(destination,'image.tar'))){deadline.throwIfAborted();retainedBytes+=chunk.length;if(retainedBytes>bytes)throw Error('Retained archive is damaged');retained.update(chunk);}
   if(retainedBytes!==bytes||retained.digest('hex')!==archiveSha256)throw Error('Retained archive is damaged');
  }
  return {directory:destination,manifest};
 }finally{await fs.rm(staging,{recursive:true,force:true});}
}
