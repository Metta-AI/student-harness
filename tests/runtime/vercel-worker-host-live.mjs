// Bounded live check of the Vercel-hosted worker supervisor (deploy/vercel-worker-host).
// Creates ONE uniquely named sandbox from the pinned public commit with FAKE worker
// credentials, so no journal, bucket, registry or builder is ever contacted. Verifies
// provisioning (clone at exact SHA, python3, npm ci), that the real supervisor starts
// and reports, then exercises the drain/stop/delete path. Requires Vercel Sandbox
// credentials (VERCEL_OIDC_TOKEN from .env.local or VERCEL_TOKEN/TEAM/PROJECT).
// Usage: node --env-file=.env.local tests/runtime/vercel-worker-host-live.mjs --live
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

if(!process.argv.includes('--live')){console.log('Pass --live to run this bounded Vercel Sandbox check');process.exit(0);}
const run=randomUUID(),name=`preston-policy-workers-fixture-${run.slice(0,8)}`;
const artifact=path.join('.artifacts/vercel-worker-host',run);await fs.mkdir(artifact,{recursive:true});
const revision=process.env.CONTAINER_POLICY_HOST_REVISION??'9bdb7df68dc1e8ac8d720b016b4748e9c82a0f4a';
const env={...process.env,CONTAINER_POLICY_HOST_NAME:name,CONTAINER_POLICY_HOST_LEASE_MINUTES:'15',CONTAINER_POLICY_HOST_REVISION:revision,CONTAINER_POLICY_SANDBOX_HOST_ENABLED:'1',
 // Fake worker credentials: storage validation passes, every network pass fails fast,
 // and the fake Vercel token means the supervisor can never create a real builder.
 SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-role',SESSION_SECRET:'ab'.repeat(32),POLICY_ARTIFACT_BUCKET:'fixture-only',
 VERCEL_TOKEN:'fixture-token',VERCEL_TEAM_ID:'fixture-team',CONTAINER_POLICY_VERCEL_PROJECT_ID:'fixture-project',
 // The SDK itself keeps the local OIDC identity (fixture-only switch).
 CONTAINER_POLICY_HOST_USE_OIDC:'1'};
Object.assign(process.env,{CONTAINER_POLICY_HOST_NAME:name,CONTAINER_POLICY_HOST_LEASE_MINUTES:'15'});
const host=await import('../../deploy/vercel-worker-host/api/host.ts');
const hostEnv=env;
const report={run,name,revision,startedAt:new Date().toISOString(),deadlineAt:new Date(Date.now()+20*60000).toISOString(),passed:false,cleanup:'unconfirmed',stages:[]};
const stage=(label,value)=>{report.stages.push({at:new Date().toISOString(),label,...value});console.log(label,JSON.stringify(value).slice(0,300));};
const overall=AbortSignal.timeout(19*60000);
try{
 // 1. Disabled flag is a no-op and creates nothing.
 const off=await host.ensure({...hostEnv,CONTAINER_POLICY_SANDBOX_HOST_ENABLED:'0'},overall);
 stage('disabled-noop',{action:off.action,sandbox:off.sandbox});assert.equal(off.action,'none');assert.equal(off.sandbox,null);
 // 2. Enabled: creates exactly one named sandbox from the pinned revision.
 // The worker env inside the sandbox uses fake tokens so nested builder creation cannot succeed.
 const created=await host.ensure(hostEnv,overall);
 stage('created',{action:created.action,sandbox:created.sandbox});assert.equal(created.action,'created');assert.equal(created.sandbox.name,name);
 // 3. A second ensure keeps the running host (idempotent cron tick).
 const kept=await host.ensure(hostEnv,overall);stage('kept',{action:kept.action,status:kept.sandbox?.status});assert.equal(kept.action,'kept');assert.equal(kept.sandbox.sessionId,created.sandbox.sessionId);
 // 4. Wait for provisioning and the real supervisor to start and report.
 const sandbox=await host.current(hostEnv,overall);let log='';
 for(let attempt=0;attempt<48&&!overall.aborted;attempt++){
  await delay(10000,undefined,{signal:overall});
  const tail=await sandbox.runCommand({cmd:'bash',args:['-c','tail -c 6000 /tmp/preston-policy-workers.log 2>/dev/null; echo; echo "--commit $(git rev-parse HEAD)"; echo "--python $(command -v python3 || echo none)"; echo "--node_modules $(test -d node_modules && echo present || echo absent)"; echo "--service $(pgrep -f "[c]ontainer-policy-service.mjs" >/dev/null && echo running || echo not-running)"'],cwd:'/vercel/student-harness',signal:AbortSignal.timeout(20000)});
  log=await tail.stdout();
  if(/container_worker_exit|container_(build|upload|practice)_pass|container_policy_service_failed/.test(log))break;
 }
 const commit=/--commit ([0-9a-f]{40})/.exec(log)?.[1],python=/--python (\S+)/.exec(log)?.[1],modules=/--node_modules (\w+)/.exec(log)?.[1],service=/--service ([\w-]+)/.exec(log)?.[1];
 const events=log.split('\n').filter(l=>l.startsWith('{"event"')).slice(-6);
 stage('provisioned',{commit,python,modules,service,events});
 assert.equal(commit,revision,'sandbox must check out the pinned revision');assert.notEqual(python,'none');assert.equal(modules,'present');
 assert(events.some(e=>/container_worker_exit|container_(build|upload|practice)_pass/.test(e)),'supervisor must launch worker generations and report');
 assert(!/container_policy_service_failed/.test(log),'service must pass its startup validation');
 // 5. Drain, stop and delete.
 const stopped=await host.stop(hostEnv,overall);stage('stopped',stopped);assert.equal(stopped.action,'stopped');
 const after=await host.current(hostEnv,overall);stage('deleted',{present:after!==null});assert.equal(after,null);
 report.cleanup='confirmed';report.passed=true;
}catch(error){
 report.error=String(error?.message??error).slice(0,400);stage('failed',{error:report.error});
}finally{
 if(report.cleanup!=='confirmed'){
  try{const left=await host.current(hostEnv);if(left){try{await left.stop({signal:AbortSignal.timeout(30000)});}catch{}await left.delete({deleteOrphanSnapshots:true,signal:AbortSignal.timeout(30000)});}report.cleanup=left?'confirmed-after-failure':'confirmed';}
  catch{report.cleanup='unconfirmed';}
 }
 report.finishedAt=new Date().toISOString();
 await fs.writeFile(path.join(artifact,'report.json'),JSON.stringify(report,null,2));
 console.log(report.passed?'PASS':'FAIL',path.join(artifact,'report.json'),'cleanup',report.cleanup);
 process.exitCode=report.passed?0:1;
}
