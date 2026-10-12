import fs from 'node:fs/promises';
import {createReadStream,writeSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

const digest=value=>createHash('sha256').update(value).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fingerprint=/^sha256:[0-9a-f]{64}$/;
const safePath=value=>typeof value==='string'&&value.length<=240&&!value.startsWith('/')&&value.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[^A-Za-z0-9_.-]/.test(p));
export function buildIdentity(input){
 if(!input||typeof input.id!=='string'||input.id.length!==36||!uuid.test(input.id)||!/^league_[0-9a-f-]{36}$/.test(input.leagueId)||!/^cow_[0-9a-f-]{36}$/.test(input.coworldId)||!fingerprint.test(input.manifestHash))throw Error('Invalid build scope');
 if(!safePath(input.dockerfile)||!Array.isArray(input.files)||input.files.length<1||input.files.length>256)throw Error('Invalid source bundle');
 if(input.platform!=='linux/amd64')throw Error('Only linux/amd64 policy builds are supported');
 const seen=new Set();let bytes=0;
 const files=input.files.map(file=>{
  if(!safePath(file.path)||seen.has(file.path)||typeof file.content!=='string'||file.content.includes('\0'))throw Error('Invalid source file');
  seen.add(file.path);bytes+=Buffer.byteLength(file.content);if(bytes>4_000_000)throw Error('Source bundle exceeds four megabytes');
  return {path:file.path,sha256:digest(file.content),bytes:Buffer.byteLength(file.content)};
 }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if(!seen.has(input.dockerfile))throw Error('Dockerfile is missing from the source bundle');
 const identity={version:1,leagueId:input.leagueId,coworldId:input.coworldId,manifestHash:input.manifestHash,platform:input.platform,dockerfile:input.dockerfile,files};
 return {...identity,sourceHash:digest(JSON.stringify(identity)),sourceBytes:bytes};
}
async function hashFile(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function atomic(file,value){const temp=file+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2),{mode:0o600});await fs.rename(temp,file);}
async function read(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
/** One admitted build per dedicated VM. No caller credentials or registry push occurs in this worker. */
export async function runBuild(input,{directory,timeoutMs=240000,signal,command=runCommand}={}){
 const identity=buildIdentity(input);if(!directory||!path.isAbsolute(directory))throw Error('Build directory must be absolute');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>600000)throw Error('Invalid build deadline');
 const root=path.join(directory,input.id),context=path.join(root,'context'),receiptPath=path.join(root,'receipt.json');
 await fs.mkdir(root,{recursive:true,mode:0o700});
 const prior=await read(receiptPath);
 if(prior){if(prior.sourceHash!==identity.sourceHash)throw Error('Build ID already belongs to another source bundle');return prior;}
 try{const lock=await fs.open(path.join(root,'claim'),'wx',0o600);await lock.writeFile(identity.sourceHash);await lock.close();}
 catch(e){if(e.code==='EEXIST'){const claimed=await fs.readFile(path.join(root,'claim'),'utf8');if(claimed&&claimed!==identity.sourceHash)throw Error('Build ID already belongs to another source bundle');return {id:input.id,sourceHash:claimed||null,status:'uncertain',message:'This build was already claimed; observe its original receipt without starting another build.'};}throw e;}
 const state={id:input.id,...identity,status:'preparing',startedAt:new Date().toISOString()};await atomic(receiptPath,state);
 const deadline=AbortSignal.any([AbortSignal.timeout(timeoutMs),...signal?[signal]:[]]);
 const log=path.join(root,'build.log');
 const run=async(cmd,args,limit=timeoutMs)=>command(cmd,args,{cwd:root,signal:deadline,timeoutMs:Math.min(limit,timeoutMs),log});
 try{
  await fs.mkdir(context,{recursive:true,mode:0o700});
  for(const file of input.files){const target=path.join(context,file.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,file.content,{mode:0o644});await fs.utimes(target,0,0);}
  state.status='building';await atomic(receiptPath,state);
  const archive=path.join(root,'image.tar'),metadata=path.join(root,'metadata.json');
  await run('docker',['buildx','build','--builder','policy-builder','--platform','linux/amd64','--provenance=false','--sbom=false','--tag',`preston-policy:${input.id}`,'--progress','plain','--output',`type=oci,compression=gzip,dest=${archive}`,'--metadata-file',metadata,'--file',path.join(context,input.dockerfile),context]);
  state.status='verifying';await atomic(receiptPath,state);
  const inspection=await run('python3',[fileURLToPath(new URL('./inspect_oci.py',import.meta.url)),archive],60000);
  const image=JSON.parse(inspection.stdout);if(image.platform!=='linux/amd64'||!fingerprint.test(image.manifestDigest))throw Error('Invalid image inspection receipt');
  const stats=await fs.stat(archive);state.status='completed';state.completedAt=new Date().toISOString();state.image={...image,reference:`preston-policy:${input.id}`,archive:'image.tar',archiveBytes:stats.size,archiveSha256:await hashFile(archive)};
  state.metadata=await read(metadata);await atomic(receiptPath,state);return state;
 }catch(error){state.status=deadline.aborted?'interrupted':'failed';state.finishedAt=new Date().toISOString();state.error=deadline.aborted?'Build deadline or cancellation reached.':'Container build or archive verification failed. Inspect the private build log.';await atomic(receiptPath,state);return state;}
}
export async function runCommand(cmd,args,{cwd,signal,timeoutMs,log}){
 signal?.throwIfAborted();const stream=await fs.open(log,'a',0o600);let stdout='',captured=0,logged=0;
 try{return await new Promise((resolve,reject)=>{
  const child=spawn(cmd,args,{cwd,env:{PATH:process.env.PATH,HOME:process.env.HOME,DOCKER_CONFIG:process.env.DOCKER_CONFIG??'/root/.docker'},detached:true,stdio:['ignore','pipe','pipe']});
  const stop=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}};const timer=setTimeout(stop,timeoutMs);
  const abort=()=>stop();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)stop();
  child.stdout.on('data',chunk=>{captured+=chunk.length;if(captured>2_000_000){stop();return;}stdout+=chunk.toString();});
  child.stderr.on('data',chunk=>{logged+=chunk.length;if(logged>4_000_000){stop();return;}try{writeSync(stream.fd,chunk);}catch{stop();}});
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  child.once('error',error=>{cleanup();reject(error);});
  child.once('close',code=>{cleanup();if(code!==0||signal?.aborted||captured>2_000_000||logged>4_000_000)reject(Error('Build command failed'));else resolve({stdout});});
 });}finally{await stream.close();}
}
/** Validate controller/worker evidence without assuming a model-authored receipt
 * confers authority. The controller also independently inspects the OCI bytes. */
export function hostedReceiptIdentity(envelope){
 const identity=buildIdentity(envelope?.input);
 if(typeof envelope.commandToken!=='string'||!uuid.test(envelope.commandToken)||envelope.commandToken.length!==36
 ||typeof envelope.providerSessionId!=='string'||!envelope.providerSessionId.length||envelope.providerSessionId.length>200
 ||!Number.isFinite(Date.parse(envelope.deadlineAt)))throw Error('Invalid hosted command envelope');
 const worker=envelope.workerIdentity;
 if(!worker||Object.keys(worker).sort().join(',')!=='inspectorSha256,installSha256,workerSha256'||Object.values(worker).some(v=>typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v)))throw Error('Invalid trusted worker identity');
 return {id:envelope.input.id,commandToken:envelope.commandToken,providerSessionId:envelope.providerSessionId,deadlineAt:envelope.deadlineAt,sourceHash:identity.sourceHash,workerIdentity:worker};
}
export function verifyHostedReceipt(envelope,receipt){
 const identity=hostedReceiptIdentity(envelope);
 for(const [key,value] of Object.entries(identity))if(!isDeepStrictEqual(receipt?.[key],value))throw Error('Hosted receipt identity mismatch');
 if(!['installing','building','completed','failed','interrupted','uncertain'].includes(receipt.status))throw Error('Invalid hosted build status');
 if(receipt.status==='completed'){
  if(receipt.build?.status!=='completed'||receipt.build.id!==identity.id||receipt.build.sourceHash!==identity.sourceHash||!receipt.toolchain)throw Error('Incomplete hosted build evidence');
  for(const [key,value] of Object.entries(buildIdentity(envelope.input)))if(!isDeepStrictEqual(receipt.build[key],value))throw Error('Hosted build differs from admitted source');
 }
 return receipt;
}
/** One installation and build for one physical VM/command token. Even a provider
 * SDK retry of its POST cannot install or build twice: the on-VM claim precedes
 * the first child process. Missing receipts remain uncertain, never replayed. */
export async function runHostedBuild(envelope,{directory,bundleDirectory=path.dirname(fileURLToPath(import.meta.url)),signal,command=runCommand,startDaemon=startDockerDaemon,build=runBuild}={}){
 envelope=structuredClone(envelope);const identity=hostedReceiptIdentity(envelope);
 if(!path.isAbsolute(directory??'')||!path.isAbsolute(bundleDirectory))throw Error('Absolute hosted build paths are required');
 const files={'worker.mjs':'workerSha256','inspect_oci.py':'inspectorSha256','install.sh':'installSha256'};
 for(const [file,key] of Object.entries(files))if(await hashFile(path.join(bundleDirectory,file))!==identity.workerIdentity[key])throw Error('Hosted worker bundle changed since admission');
 const root=path.join(directory,identity.id),receiptPath=path.join(root,'hosted-receipt.json');await fs.mkdir(root,{recursive:true,mode:0o700});
 try{const lock=await fs.open(path.join(root,'hosted-claim'),'wx',0o600);try{await lock.writeFile(JSON.stringify(identity));}finally{await lock.close();}}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  const raw=await fs.readFile(path.join(root,'hosted-claim'),'utf8');
  if(!raw)return {...identity,status:'uncertain',message:'Original worker claim is not yet readable.'};
  if(!isDeepStrictEqual(JSON.parse(raw),identity))throw Error('Hosted command identity conflict');
  const prior=await read(receiptPath);return prior?verifyHostedReceipt(envelope,prior):{...identity,status:'uncertain',message:'Original worker was admitted; its receipt is not available.'};
 }
 const remaining=Date.parse(identity.deadlineAt)-Date.now();
 const deadline=AbortSignal.any([(remaining<=0?AbortSignal.abort(Error('Hosted deadline expired')):AbortSignal.timeout(Math.min(600000,remaining))),...signal?[signal]:[]]);
 const receipt={...identity,status:'installing',startedAt:new Date().toISOString()};let daemon;
 const run=(cmd,args,timeoutMs)=>command(cmd,args,{cwd:root,signal:deadline,timeoutMs:Math.max(1,Math.min(timeoutMs,Date.parse(identity.deadlineAt)-Date.now())),log:path.join(root,'setup.log')});
 await atomic(receiptPath,receipt);
 try{
  deadline.throwIfAborted();if(remaining>600000)throw Error('Hosted command deadline is too long');
  await run('bash',[path.join(bundleDirectory,'install.sh')],180000);
  deadline.throwIfAborted();daemon=await startDaemon({root,signal:deadline});
  let ready=false;
  for(let attempt=0;attempt<30;attempt++){
   deadline.throwIfAborted();
   try{await run('docker',['info'],5000);ready=true;break;}catch{deadline.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,1000));}
  }
  if(!ready)throw Error('Docker did not become ready');
  await run('docker',['buildx','create','--name','policy-builder','--driver','docker-container','--use'],30000);
  receipt.toolchain={node:process.version,docker:JSON.parse((await run('docker',['version','--format','{{json .Server}}'],10000)).stdout),buildx:(await run('docker',['buildx','version'],10000)).stdout.trim(),python:(await run('python3',['--version'],10000)).stdout.trim()};
  receipt.status='building';await atomic(receiptPath,receipt);
  deadline.throwIfAborted();const budget=Date.parse(identity.deadlineAt)-Date.now();if(budget<1000)throw Error('Build deadline reached');
  receipt.build=await build(envelope.input,{directory,signal:deadline,timeoutMs:Math.min(240000,budget)});
  receipt.status=receipt.build.status==='completed'?'completed':receipt.build.status==='interrupted'?'interrupted':'failed';
 }catch{receipt.status=deadline.aborted?'interrupted':'failed';receipt.error='Hosted setup or build did not finish. Inspect the private setup/build logs.';}
 finally{try{await daemon?.stop();}catch{receipt.daemonCleanup='unconfirmed';}}
 receipt.finishedAt=new Date().toISOString();await atomic(receiptPath,receipt);return receipt;
}
async function startDockerDaemon({root,signal}){
 signal.throwIfAborted();const log=await fs.open(path.join(root,'docker.log'),'a',0o600);
 const child=spawn('dockerd',['--host=unix:///var/run/docker.sock'],{env:{PATH:process.env.PATH,HOME:process.env.HOME},detached:true,stdio:['ignore','ignore','pipe']});
 let closed=false,logged=0,settle;
 const completion=new Promise(resolve=>settle=resolve);
 const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}};
 const abort=()=>kill();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 child.stderr.on('data',chunk=>{logged+=chunk.length;if(logged<=4_000_000){try{writeSync(log.fd,chunk);}catch{kill();}}});
 child.once('error',()=>{closed=true;settle();});child.once('close',()=>{closed=true;settle();});
 return {async stop(){
  try{if(!closed){try{process.kill(-child.pid,'SIGTERM');}catch{}const timer=setTimeout(kill,3000);try{await completion;}finally{clearTimeout(timer);}}}
  finally{signal.removeEventListener('abort',abort);await log.close();}
 }};
}
// Bundlers may inline this library into a server entrypoint. Only the shipped
// worker filename is a CLI; importing identity helpers must never execute it.
if(process.argv[1]&&path.basename(process.argv[1])==='worker.mjs'&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const hosted=process.argv[2]==='--hosted';const [inputFile,directory]=process.argv.slice(hosted?3:2);
 try{const input=JSON.parse(await fs.readFile(inputFile,'utf8'));const result=hosted?await runHostedBuild(input,{directory}):await runBuild(input,{directory});
 console.log(JSON.stringify({id:result.id,status:result.status,sourceHash:result.sourceHash,image:result.image}));if(result.status!=='completed')process.exitCode=1;
 }catch{console.error('Build request could not be admitted.');process.exitCode=1;}
}
