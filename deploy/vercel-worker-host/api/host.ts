import {timingSafeEqual} from 'node:crypto';
import {Sandbox} from '@vercel/sandbox';

/** Keeps exactly one named Vercel Sandbox running the existing SQL-journal
 * policy-worker supervisor (scripts/container-policy-service.mjs) from a
 * pinned public commit. The cron calls `ensure` every ten minutes; a running
 * host is left alone, a finished or failed one is replaced. SQL leases and
 * original operation IDs remain the authority for the work itself; this
 * function never admits, cancels or retries a policy operation. */

/** Overridable only so bounded live fixtures never collide with the production host. */
const SANDBOX_NAME=process.env.CONTAINER_POLICY_HOST_NAME?.trim()||'preston-policy-workers';
const REPOSITORY='https://github.com/Metta-AI/student-harness.git';
/** The git source is cloned next to the sandbox home, named after the repository. */
const CHECKOUT='/vercel/student-harness';
/** Pro sandboxes may run 24h. Keep the lease under that and let the
 * supervisor exit on its own before the sandbox deadline. */
const LEASE_MINUTES=Math.min(720,Math.max(10,Number(process.env.CONTAINER_POLICY_HOST_LEASE_MINUTES)||720));
const LEASE_MS=LEASE_MINUTES*60*1000;
const SERVICE_MINUTES=Math.max(1,LEASE_MINUTES-20);
const WORKER_KEYS=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SESSION_SECRET','POLICY_ARTIFACT_BUCKET','VERCEL_TOKEN','VERCEL_TEAM_ID','VERCEL_PROJECT_ID'] as const;
type Env=Record<string,string|undefined>;

function clean(value:string|undefined){return typeof value==='string'&&value&&value===value.trim()&&!/[\r\n]/.test(value)?value:null;}
/** Same semantics as lib/container-policy/provider-credentials.ts: an unset
 * token means the SDK's own OIDC; a partial configuration fails closed. */
export function credentials(env:Env=process.env){
 // Fixture-only: lets a bounded live check hand FAKE worker tokens to the sandbox
 // while the SDK itself keeps its OIDC identity. Never set in production.
 if(env.CONTAINER_POLICY_HOST_USE_OIDC==='1'||env.VERCEL_TOKEN===undefined)return {};
 const token=clean(env.VERCEL_TOKEN),teamId=clean(env.VERCEL_TEAM_ID),projectId=clean(env.VERCEL_PROJECT_ID);
 if(!token||!teamId||!projectId)throw Error('Incomplete Vercel credentials');
 return {token,teamId,projectId};
}
export function revision(env:Env=process.env){
 const value=clean(env.CONTAINER_POLICY_HOST_REVISION);
 if(!value||!/^[0-9a-f]{40}$/.test(value))throw Error('CONTAINER_POLICY_HOST_REVISION must be a full commit SHA');
 return value;
}
/** Environment handed to the worker sandbox. It is the same set the Helm
 * chart mounts from the ESO secret; nothing else from this function's
 * environment is forwarded. */
export function workerEnvironment(env:Env=process.env){
 const out:Record<string,string>={NODE_ENV:'production',CI:'true',CONTAINER_POLICY_PIPELINE_ENABLED:'0',CONTAINER_POLICY_PRACTICE_ENABLED:'0',
  CONTAINER_POLICY_PRACTICE_WORKER_ENABLED:env.CONTAINER_POLICY_PRACTICE_WORKER_ENABLED==='0'?'0':'1'};
 for(const key of WORKER_KEYS){const value=clean(env[key]);if(!value)throw Error(`Missing worker environment: ${key}`);out[key]=value;}
 if(!/^([0-9a-f]{2}){32}$/i.test(out.SESSION_SECRET))throw Error('SESSION_SECRET must be the existing 64-hex sealing key');
 return out;
}
function enabled(env:Env=process.env){return env.CONTAINER_POLICY_SANDBOX_HOST_ENABLED==='1';}
function missing(error:unknown){return error instanceof Error&&'response' in error&&(error.response as Response)?.status===404;}
const bounded=(ms:number,signal?:AbortSignal)=>signal?AbortSignal.any([signal,AbortSignal.timeout(ms)]):AbortSignal.timeout(ms);

export async function current(env:Env=process.env,signal?:AbortSignal){
 try{return await Sandbox.get({...credentials(env),name:SANDBOX_NAME,resume:false,signal:bounded(15000,signal)});}
 catch(error){if(missing(error))return null;throw error;}
}
function describe(sandbox:Sandbox|null){
 if(!sandbox)return null;
 return {name:sandbox.name,sessionId:sandbox.sandboxId,status:sandbox.status,timeoutMs:sandbox.timeout??null,statusUpdatedAt:sandbox.statusUpdatedAt?.toISOString()??null};
}
/** Provisioning runs detached inside the sandbox so the function returns in
 * seconds. The supervisor's own JSON lines are the only output retained. */
const PROVISION=[
 'set -euo pipefail',
 'test -f package-lock.json',
 'command -v python3 >/dev/null 2>&1 || (sudo apt-get update -qq && sudo apt-get install -y -qq python3)',
 'python3 -c "import hashlib,json,tarfile,zlib"',
 'npm ci --omit=dev --ignore-scripts --no-audit --no-fund',
 `exec node scripts/container-policy-service.mjs --duration-minutes=${SERVICE_MINUTES}`,
].join('\n');

export async function ensure(env:Env=process.env,signal?:AbortSignal){
 const sha=revision(env),existing=await current(env,signal);
 if(!enabled(env))return {enabled:false,action:'none',sandbox:describe(existing)};
 if(existing&&(existing.status==='running'||existing.status==='pending'||existing.status==='snapshotting'))return {enabled:true,action:'kept',sandbox:describe(existing)};
 if(existing){
  // A stopped, failed or aborted host cannot be resumed; its journals are in SQL.
  await existing.delete({deleteOrphanSnapshots:true,signal:bounded(30000,signal)});
 }
 const sandbox=await Sandbox.create({...credentials(env),name:SANDBOX_NAME,source:{type:'git',url:REPOSITORY,revision:sha,depth:1},
  timeout:LEASE_MS,resources:{vcpus:2},persistent:false,env:workerEnvironment(env),
  tags:{purpose:'preston-policy-workers',revision:sha.slice(0,12)},signal:bounded(60000,signal)});
 await sandbox.runCommand({cmd:'bash',args:['-c',`(${PROVISION}) > /tmp/preston-policy-workers.log 2>&1`],cwd:CHECKOUT,detached:true,signal:bounded(20000,signal)});
 return {enabled:true,action:existing?'replaced':'created',revision:sha,sandbox:describe(sandbox)};
}

export async function status(env:Env=process.env,signal?:AbortSignal){
 const sandbox=await current(env,signal);
 let log:string[]=[];
 if(sandbox&&sandbox.status==='running'){
  try{
   const result=await sandbox.runCommand({cmd:'tail',args:['-c','4096','/tmp/preston-policy-workers.log'],signal:bounded(15000,signal)});
   log=(await result.stdout()).split('\n').filter(line=>/^\{"event":"container_(build|upload|practice)_pass"|^\{"event":"container_worker_exit"/.test(line)).slice(-12);
  }catch{log=['<log unavailable>'];}
 }
 return {enabled:enabled(env),sandbox:describe(sandbox),recent:log};
}

/** Drain first (SIGTERM to the supervisor, which drains its children for up
 * to two minutes), then stop and delete the sandbox. Admitted cloud builders
 * are not touched; their journals continue with the next host. */
export async function stop(env:Env=process.env,signal?:AbortSignal){
 const sandbox=await current(env,signal);
 if(!sandbox)return {action:'absent'};
 let drained=false;
 if(sandbox.status==='running'){
  try{
   await sandbox.runCommand({cmd:'pkill',args:['-TERM','-f','scripts/container-policy-service.mjs'],signal:bounded(10000,signal)});
   const deadline=Date.now()+135000;
   while(Date.now()<deadline){
    const check=await sandbox.runCommand({cmd:'pgrep',args:['-f','scripts/container-policy-service.mjs'],signal:bounded(10000,signal)});
    if(check.exitCode!==0){drained=true;break;}
    await new Promise(resolve=>setTimeout(resolve,5000));
   }
  }catch{drained=false;}
  await sandbox.stop({signal:bounded(30000,signal)});
 }
 await sandbox.delete({deleteOrphanSnapshots:true,signal:bounded(30000,signal)});
 return {action:'stopped',drained,sandbox:describe(sandbox)};
}

function authorized(request:Request,env:Env=process.env){
 const secret=clean(env.CRON_SECRET),header=request.headers.get('authorization')??'';
 if(!secret||secret.length<32)return false;
 const expected=Buffer.from(`Bearer ${secret}`),given=Buffer.from(header);
 return expected.length===given.length&&timingSafeEqual(expected,given);
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});

export async function GET(request:Request){
 if(!authorized(request))return json({error:'unauthorized'},401);
 const action=new URL(request.url).searchParams.get('action')??'ensure';
 try{
  if(action==='ensure')return json(await ensure());
  if(action==='status')return json(await status());
  return json({error:'unknown action'},400);
 }catch(error){
  console.error(JSON.stringify({event:'policy_worker_host_failed',action,message:error instanceof Error?error.message.slice(0,200):'failed'}));
  return json({error:error instanceof Error?error.message.slice(0,200):'failed'},500);
 }
}
export async function POST(request:Request){
 if(!authorized(request))return json({error:'unauthorized'},401);
 const action=new URL(request.url).searchParams.get('action');
 try{
  if(action==='stop')return json(await stop());
  if(action==='ensure')return json(await ensure());
  return json({error:'unknown action'},400);
 }catch(error){
  console.error(JSON.stringify({event:'policy_worker_host_failed',action,message:error instanceof Error?error.message.slice(0,200):'failed'}));
  return json({error:error instanceof Error?error.message.slice(0,200):'failed'},500);
 }
}
