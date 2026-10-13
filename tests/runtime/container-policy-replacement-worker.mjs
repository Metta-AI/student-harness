// Fixture-only worker generation for tests/runtime/container-policy-replacement.mjs.
// It runs the REAL hosted build worker loop, dispatcher, controller, recovery
// store, command store, trusted bundle hashing and storage configuration against
// a disposable PostgREST journal. Only the external ports are faked: the Sandbox
// provider, the command gateway, archive collection and the transfer store.
// Every provider/gateway effect is appended to a shared JSON-lines ledger so the
// orchestrator can prove that a replacement generation observed the original
// builder instead of creating another one.
//
// Refuses to run unless the journal is a loopback PostgREST and a ledger path is
// set, so it can never be pointed at a hosted database.
import {registerHooks} from 'node:module';
import fs from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const env=process.env;
const generation=env.FIXTURE_GENERATION,ledger=env.FIXTURE_LEDGER;
const holdMs=Number(env.FIXTURE_HOLD_MS??'30000'),passMs=Number(env.FIXTURE_PASS_INTERVAL_MS??'2000');
if(!/^[A-Z]$/.test(generation??'')||!ledger||!/^http:\/\/127\.0\.0\.1:\d+$/.test(env.SUPABASE_URL??'')||env.NEXT_PUBLIC_SUPABASE_URL||env.SUPABASE_SECRET_KEY)throw Error('Replacement fixture worker only runs against a loopback fixture journal');
if(!Number.isSafeInteger(holdMs)||holdMs<1000||holdMs>50000||!Number.isSafeInteger(passMs)||passMs<500||passMs>60000)throw Error('Invalid fixture hold or pass interval');
const args=process.argv.slice(2);
if(args.length!==1||!/^--duration-minutes=\d+$/.test(args[0]))throw Error('Use --duration-minutes=N');
const minutes=Number(args[0].split('=')[1]);if(!Number.isSafeInteger(minutes)||minutes<1||minutes>5)throw Error('Fixture worker duration must be 1–5 minutes');

const record=(event,extra={})=>{appendFileSync(ledger,JSON.stringify({at:new Date().toISOString(),pid:process.pid,generation,event,...extra})+'\n');};
async function entries(){try{return (await fs.readFile(ledger,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if(error.code==='ENOENT')return [];throw error;}}
const observation=(name,sessionId)=>({name,sessionId,status:'running',stop:async()=>{record('provider.stop',{name,sessionId});}});

/** Fake Sandbox provider. create() mints one physical session identity and
 * journals it; observe() only returns what an earlier create() journaled, like
 * Sandbox.get on a named builder. Nothing is ever recreated here. */
const provider={
 async create(b,signal){
  signal.throwIfAborted();
  record('provider.create',{build:b.id,name:b.provider_name});
  const sessionId='sbx_fixture_'+randomUUID().replaceAll('-','');
  record('provider.created',{build:b.id,name:b.provider_name,sessionId});
  return observation(b.provider_name,sessionId);
 },
 async observe(b,signal){
  signal.throwIfAborted();
  const created=(await entries()).find(e=>e.event==='provider.created'&&e.name===b.provider_name);
  record('provider.observe',{build:b.id,name:b.provider_name,found:Boolean(created),sessionId:created?.sessionId??null});
  return created?observation(b.provider_name,created.sessionId):null;
 },
};
/** Fake command gateway. start() parks for the configured hold so the SQL job
 * lease stays active, as a long provider call would; SIGTERM aborts it. observe()
 * never finds a receipt, keeping the build parked in 'building'. */
const gateway={
 async start(b,envelope,bundle,authorize,signal){
  record('gateway.start',{build:b.id,session:envelope.providerSessionId,commandToken:envelope.commandToken,bundleFiles:bundle.files.length});
  await authorize();
  try{await delay(holdMs,undefined,{signal});}
  catch(error){record('gateway.start.aborted',{build:b.id});throw error;}
  const commandId='cmd_fixture_'+envelope.commandToken;
  record('gateway.started',{build:b.id,commandId});
  return commandId;
 },
 async observe(b,command,signal){
  signal.throwIfAborted();
  record('gateway.observe',{build:b.id,session:command.provider_session_id,commandId:command.command_id,receipt:null});
  return null;
 },
};
const collect=async b=>{record('collect.unexpected',{build:b.id});throw Error('Fixture never reaches archive collection');};
const transfers={input:async()=>{record('transfer.unexpected');throw Error('Fixture never reaches retention');},rpc:async()=>{record('transfer.unexpected');throw Error('Fixture never reaches retention');}};

const hooks=registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(s+'.ts',c);throw e;}}});
const controller=new AbortController(),deadlineAt=Date.now()+minutes*60000;
const stop=signalName=>()=>{record('signal',{signal:signalName});controller.abort();};
const onTerm=stop('SIGTERM'),onInt=stop('SIGINT');process.on('SIGTERM',onTerm);process.on('SIGINT',onInt);
record('start',{argv:args,holdMs,passMs});
let code=0;
try{
 const [{containerStorageFromEnvironment,runContainerBuildWorker,dueContainerScopes},{createContainerBuildDispatcher,containerDispatchCandidates},{reconcileHostedBuild},{recoveryStore},{commandStore,trustedBuildBundle}]=await Promise.all([
  import('../../lib/container-policy/worker.ts'),import('../../lib/container-policy/dispatch.ts'),import('../../lib/container-policy/controller.ts'),import('../../lib/container-policy/recovery.ts'),import('../../lib/container-policy/commands.ts'),
 ]);
 const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(minutes*60000)]);
 const storage=containerStorageFromEnvironment(env,signal);
 const hosted={provider,recovery:recoveryStore,commands:commandStore,gateway,bundle:trustedBuildBundle,collect,transfers};
 const ports={
  scopes:dueContainerScopes,now:Date.now,
  // The real worker rests at least a minute between passes; the fixture shortens
  // only this process-local rest. SQL next_at/job_until still gate every build.
  wait:async(ms,s)=>{await delay(Math.min(ms,passMs),undefined,{signal:s});},
  report:value=>{record('pass',{scopes:value.scopes,builds:value.builds,errors:value.errors});console.log(JSON.stringify(value));},
  dispatch:async(scope,st,s)=>{
   const dispatch=createContainerBuildDispatcher({now:Date.now,
    candidates:async(...a)=>{s.throwIfAborted();return containerDispatchCandidates(...a);},
    reconcile:async(student,id,storageArg,_ports,inner)=>{inner?.throwIfAborted();record('reconcile.begin',{build:id});
     try{const result=await reconcileHostedBuild(student,id,storageArg,hosted,inner);record('reconcile.end',{build:id,state:result.provider.state,command:result.command?.state??null});return result;}
     catch(error){record('reconcile.error',{build:id});throw error;}},
   });
   return dispatch(scope,st,s);
  },
 };
 await runContainerBuildWorker({storage,signal,deadlineAt,ports});
}catch{code=1;console.error(JSON.stringify({event:'container_replacement_worker_failed'}));}
finally{process.off('SIGTERM',onTerm);process.off('SIGINT',onInt);hooks.deregister();record('exit',{code});process.exitCode=code;}
