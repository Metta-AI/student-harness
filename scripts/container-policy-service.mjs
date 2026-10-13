import {spawn,execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';

const repository=fileURLToPath(new URL('../',import.meta.url));
const kinds=['build','upload','practice'];
const scripts={build:'container-policy-worker.mjs',upload:'container-policy-upload-worker.mjs',practice:'container-policy-practice-worker.mjs'};
const report=value=>console.log(JSON.stringify(value));

/** Child lifetime is bounded by its existing CLI. Restart only after close proves
 * the old local process exited. SIGTERM drains durable receipts; after two minutes
 * SIGKILL removes a stuck local process group, never a cloud builder or its IDs. */
export function launchPolicyWorker(kind,minutes,{spawnImpl=spawn,emit=report,drainMs=120000}={}){
 if(!kinds.includes(kind)||!Number.isInteger(minutes)||minutes<1||minutes>120)throw Error('Invalid supervised worker');
 const child=spawnImpl(process.execPath,[path.join(repository,'scripts',scripts[kind]),`--duration-minutes=${minutes}`],{cwd:repository,env:process.env,stdio:['ignore','pipe','ignore'],detached:process.platform!=='win32'});
 let terminal=false,timer,stopping=false;const signal=name=>{if(terminal)return;try{if(process.platform==='win32')child.kill(name);else process.kill(-child.pid,name);}catch(error){if(error.code!=='ESRCH')throw error;}};
 // Whitelist existing worker count reports. Ignore arbitrary output, oversized
 // lines and errors; source, command receipts and credentials never enter logs.
 let line='',dropping=false;
 child.stdout?.on('data',chunk=>{
  for(const part of chunk.toString().split(/(?<=\n)/)){
   if(!dropping){line+=part;if(line.length>2048){line='';dropping=true;}}
   if(part.endsWith('\n')){
    if(!dropping)try{const value=JSON.parse(line);const fields=kind==='build'?['scopes','builds','errors']:['examined',kind==='practice'?'practices':'uploads','errors'];if(value.event===`container_${kind}_pass`&&fields.every(key=>Number.isSafeInteger(value[key])&&value[key]>=0))emit({event:value.event,...Object.fromEntries(fields.map(key=>[key,value[key]]))});}catch{}
    line='';dropping=false;
   }
  }
 });
 const done=new Promise(resolve=>{
  let failed=false;child.once('error',()=>{failed=true;});
  child.once('close',(code,exitSignal)=>{terminal=true;clearTimeout(timer);resolve({code:failed?1:code,signal:exitSignal??null});});
 });
 return {done,stop(){if(stopping||terminal)return;stopping=true;signal('SIGTERM');timer=setTimeout(()=>signal('SIGKILL'),drainMs);}};
}

/** Runs only when explicitly called. Two base child slots and an optional practice slot, with no
 * overlapping generations. Process supervision does not replace SQL leases or
 * enable the chat flag. A host process manager may restart this bounded service.
 * Temporal is optional: use the existing durable SQL jobs from these workers;
 * do not wrap uncertain registration in a retrying workflow activity. */
export async function runContainerPolicyService({signal,deadlineAt,workerMinutes=120,practice=false,ports={launch:launchPolicyWorker,wait:async(ms,s)=>{await delay(ms,undefined,{signal:s});},now:Date.now,report}}){
 if(!Number.isFinite(deadlineAt)||deadlineAt<=ports.now()||deadlineAt-ports.now()>1440*60000||!Number.isInteger(workerMinutes)||workerMinutes<1||workerMinutes>120)throw Error('Invalid container service lifetime');
 const shutdown=new AbortController(),lifetime=AbortSignal.any([signal,shutdown.signal,AbortSignal.timeout(Math.ceil(deadlineAt-ports.now()))]);
 const outcomes=await Promise.allSettled((practice?kinds:kinds.filter(kind=>kind!=='practice')).map(async kind=>{
  let failures=0;
  while(!lifetime.aborted&&ports.now()<deadlineAt){
   const minutes=Math.max(1,Math.min(workerMinutes,Math.ceil((deadlineAt-ports.now())/60000)));
   let child,result;
   const stop=()=>child?.stop();
   try{
    child=ports.launch(kind,minutes);lifetime.addEventListener('abort',stop,{once:true});if(lifetime.aborted)stop();
    result=await child.done;
   }catch{result={code:1,signal:null};}
   finally{lifetime.removeEventListener('abort',stop);}
   failures=result.code===0?0:failures+1;ports.report({event:'container_worker_exit',worker:kind,failed:result.code!==0});
   if(lifetime.aborted||ports.now()>=deadlineAt)break;
   const rest=Math.min(900000,60000*2**Math.min(Math.max(0,failures-1),4));
   try{await ports.wait(Math.min(rest,deadlineAt-ports.now()),lifetime);}catch{if(!lifetime.aborted)throw Error('Container service wait failed');}
  }
 }).map(task=>task.catch(()=>{shutdown.abort();throw Error('Container service role failed');})));
 if(outcomes.some(result=>result.status==='rejected'))throw Error('Container service role failed');
}

/** Explicit command, normally under systemd/launchd/container restart supervision:
 * node --env-file-if-exists=.env.local scripts/container-policy-service.mjs
 * Default service scheduling lifetime24h; worker generations120min. On service
 * rollover the host restarts it after successful drain. Never add this to UI/dev
 * startup until migrations, private bucket and live pipeline qualification pass.
 */
export async function main(args=process.argv.slice(2)){
 if(args.length>1||args.length===1&&!/^--duration-minutes=\d+$/.test(args[0]))throw Error('Use --duration-minutes=N');
 const minutes=args.length?Number(args[0].split('=')[1]):1440;
 if(!Number.isInteger(minutes)||minutes<1||minutes>1440)throw Error('Invalid container service duration');
 const env=process.env,url=env.SUPABASE_URL??env.NEXT_PUBLIC_SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY??env.SUPABASE_SECRET_KEY,bucket=env.POLICY_ARTIFACT_BUCKET;
 if(!url||!key||!bucket||!/^([0-9a-f]{2}){32}$/i.test(env.SESSION_SECRET??''))throw Error('Container service storage and token encryption are not configured');
 // OCI verification runs outside the builder too; an empty queue must not hide
 // a missing verifier dependency until a student's first completed build.
 try{execFileSync('python3',['-c','import hashlib,json,tarfile,zlib'],{timeout:5000,stdio:'pipe'});}catch{throw Error('Container service requires Python 3 for independent artifact verification');}
 const hooks=registerHooks({resolve(s,c,next){try{return next(s,c);}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(s+'.ts',c);throw error;}}});
 const controller=new AbortController(),stop=()=>controller.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{
  const {containerArtifactStorageConfiguration}=await import('../lib/container-policy/storage-config.ts');containerArtifactStorageConfiguration(env);
  await runContainerPolicyService({signal:controller.signal,deadlineAt:Date.now()+minutes*60000,practice:env.CONTAINER_POLICY_PRACTICE_WORKER_ENABLED==='1'});
 }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);hooks.deregister();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await main();}catch{console.error(JSON.stringify({event:'container_policy_service_failed'}));process.exitCode=1;}
}
