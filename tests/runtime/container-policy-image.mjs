import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

// Explicit qualification only: no env file, credentials, exposed ports or network.
// Every role must import and attempt its bounded read, then drain on SIGTERM.
const image=process.argv[2];
if(!image||!/^[-a-zA-Z0-9_./:@]+$/.test(image))throw Error('Pass the already-built worker image reference');
const name=`policy-worker-fixture-${randomUUID()}`;
const docker=(args,timeout=10000)=>execFileSync('docker',args,{encoding:'utf8',timeout,maxBuffer:100000,stdio:['ignore','pipe','pipe']});
try{
 const missing=docker(['run','--rm','--network=none','--read-only',image]).trim();
 throw Error(`Unconfigured worker unexpectedly started: ${missing.length}`);
}catch(error){assert.equal(error.status,1);assert(String(error.stderr).includes('container_policy_service_failed'));}
try{
 docker(['run','--detach','--name',name,'--network=none','--read-only','--tmpfs','/tmp:rw,size=67108864',
  '--env','SUPABASE_URL=http://127.0.0.1:9','--env','SUPABASE_SERVICE_ROLE_KEY=fixture-private-key',
  '--env',`SESSION_SECRET=${'11'.repeat(32)}`,'--env','POLICY_ARTIFACT_BUCKET=fixture-artifacts',
  '--env','VERCEL_TOKEN=fixture-token','--env','VERCEL_TEAM_ID=team_fixture','--env','VERCEL_PROJECT_ID=prj_fixture',
  '--env','CONTAINER_POLICY_PRACTICE_WORKER_ENABLED=1',image,'--duration-minutes=1']);
 const deadline=Date.now()+45000;let ready=false;
 while(Date.now()<deadline){
  const log=docker(['logs',name]);
  ready=['build','upload','practice'].every(kind=>log.includes(`"event":"container_${kind}_pass"`));
  if(ready)break;
  assert.equal(docker(['inspect','--format','{{.State.Running}}',name]).trim(),'true','worker exited before all roles imported');
  await delay(2000);
 }
 assert(ready,'all three real worker roles must import and report a bounded failed discovery');
 docker(['stop','--time','20',name],30000);
 assert.equal(docker(['inspect','--format','{{.State.ExitCode}}',name]).trim(),'0','SIGTERM must drain gracefully');
 const log=docker(['logs',name]);
 assert(!log.includes('fixture-private-key')&&!log.includes('fixture-token'));
 console.log(JSON.stringify({passed:true,roles:3,network:'none',gracefulExit:true}));
}finally{docker(['rm','--force',name]);}
