import {Sandbox} from '@vercel/sandbox';
import {containerProviderCredentials} from './provider-credentials.ts';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {isDeepStrictEqual} from 'node:util';
import {verifyHostedReceipt} from '../../workers/policy-build/worker.mjs';
import type {BuildEnvelope,CommandGateway,WorkerBundle} from './commands';
import type {RecoveryBuild} from './recovery';

export const buildWorkerRoot='/vercel/sandbox/policy-build';
const bounded=(signal:AbortSignal)=>AbortSignal.any([signal,AbortSignal.timeout(15000)]);
async function originalSession(b:RecoveryBuild,signal:AbortSignal){
 if(!b.provider_session_id)throw Error('Physical builder session is not bound');
 const sandbox=await Sandbox.get({...containerProviderCredentials(),name:b.provider_name,resume:false,signal:bounded(signal)});
 const session=sandbox.currentSession();
 if(sandbox.name!==b.provider_name||session.sessionId!==b.provider_session_id)throw Error('Physical builder identity changed');
 return session;
}
function verifyBundle(bundle:WorkerBundle){
 const expected={'worker.mjs':bundle.identity.workerSha256,'inspect_oci.py':bundle.identity.inspectorSha256,'install.sh':bundle.identity.installSha256};
 if(bundle.files.length!==3||new Set(bundle.files.map(f=>f.name)).size!==3)throw Error('Invalid trusted worker bundle');
 for(const f of bundle.files)if(!(f.name in expected)||createHash('sha256').update(f.content).digest('hex')!==expected[f.name as keyof typeof expected])throw Error('Trusted worker bytes changed');
}
export const vercelCommandGateway:CommandGateway={
 async start(b,envelope,bundle,authorize,signal){
  verifyBundle(bundle);const session=await originalSession(b,signal);
  const remaining=Date.parse(b.deadline_at)-Date.now();if(!Number.isFinite(remaining)||remaining<1000||remaining>600000)throw Error('Builder deadline expired');
  await authorize();
  await session.writeFiles([...bundle.files.map(f=>({path:buildWorkerRoot+'/'+f.name,content:f.content})),{path:buildWorkerRoot+'/request.json',content:Buffer.from(JSON.stringify(envelope))}],{signal:bounded(signal)});
  await authorize();
  // Use the physical session, not Sandbox.runCommand (which can auto-resume).
  // SDK HTTP retries are additionally fenced by hosted-claim before setup.
  const command=await session.runCommand({cmd:'node',args:[buildWorkerRoot+'/worker.mjs','--hosted',buildWorkerRoot+'/request.json',buildWorkerRoot+'/builds'],sudo:true,detached:true,timeoutMs:Math.max(1,Date.parse(b.deadline_at)-Date.now()),signal:bounded(signal)});
  return command.cmdId;
 },
 async observe(b,command,signal){
  if(command.provider_session_id!==b.provider_session_id||command.build_id!==b.id)throw Error('Command scope mismatch');
  const session=await originalSession(b,signal);
  const stream=await session.readFile({path:`${buildWorkerRoot}/builds/${b.id}/hosted-receipt.json`},{signal:bounded(signal)});
  if(!stream)return null;
  const chunks:Buffer[]=[];let size=0;
  try{for await(const chunk of stream){signal.throwIfAborted();const data=Buffer.from(chunk);size+=data.length;if(size>128000)throw Error('Hosted receipt exceeds its limit');chunks.push(data);}}
  finally{if('destroy' in stream)(stream as NodeJS.ReadableStream&{destroy:()=>void}).destroy();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 },
};

/** Read only the completed archive from its original physical VM. Stream to a
 * controller-owned temporary file; never trust a worker-provided remote path. */
export async function collectContainerArchive(b:RecoveryBuild,envelope:BuildEnvelope,receipt:unknown,file:string,outerSignal:AbortSignal){
 const verified=verifyHostedReceipt(envelope,receipt);
 if(verified.status!=='completed'||envelope.input.id!==b.id||envelope.providerSessionId!==b.provider_session_id
 ||Date.parse(envelope.deadlineAt)!==Date.parse(b.deadline_at)||!isDeepStrictEqual(envelope.workerIdentity,b.worker_identity))throw Error('Archive collection scope mismatch');
 const bytes=verified.build.image?.archiveBytes,sha256=verified.build.image?.archiveSha256;
 if(!Number.isSafeInteger(bytes)||bytes<1||bytes>250_000_000||typeof sha256!=='string'||!/^[0-9a-f]{64}$/.test(sha256))throw Error('Invalid archive collection identity');
 const signal=AbortSignal.any([outerSignal,AbortSignal.timeout(50000)]);
 signal.throwIfAborted();const session=await originalSession(b,signal);
 const stream=await session.readFile({path:`${buildWorkerRoot}/builds/${b.id}/image.tar`},{signal});
 if(!stream)throw Error('Original builder archive is unavailable');
 let owned=false,total=0;const hash=createHash('sha256');
 try{
  // Exclusive creation prevents replacement or deletion of another collector's file.
  const handle=await fs.open(file,'wx',0o600);owned=true;await handle.close();
  const meter=new Transform({transform(chunk,_encoding,callback){
   total+=chunk.length;if(total>bytes){callback(Error('Builder archive exceeds its declared size'));return;}
   hash.update(chunk);callback(null,chunk);
  }});
  await pipeline(stream,meter,createWriteStream(file,{flags:'r+',mode:0o600}),{signal});
  if(total!==bytes||hash.digest('hex')!==sha256)throw Error('Builder archive digest or size mismatch');
  return {file,bytes,sha256};
 }catch(error){if(owned)await fs.rm(file,{force:true});throw error;}
 finally{if('destroy' in stream)(stream as NodeJS.ReadableStream&{destroy:()=>void}).destroy();}
}
