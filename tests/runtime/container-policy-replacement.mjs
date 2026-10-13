// Disposable, bounded pod-replacement fixture for the hosted policy build worker.
// Three generations of tests/runtime/container-policy-replacement-worker.mjs run
// the real worker loop, dispatcher, controller, recovery and command stores
// against a disposable PostgreSQL/PostgREST journal with every migration applied.
// Only the Sandbox provider, command gateway, archive collection and transfer
// store are fakes. The fixture proves that replacing the worker process keeps the
// original build, provider session and command identities and never creates a
// second builder or command. No Docker, Electron, Vercel Sandbox, registry,
// Kubernetes or hosted database is involved. Run from the repository root:
//   node tests/runtime/container-policy-replacement.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import http from 'node:http';import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';import {once} from 'node:events';
import {randomUUID,randomBytes,createHmac,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const repo=process.cwd(),worker=path.join(repo,'tests/runtime/container-policy-replacement-worker.mjs');
await fs.access(path.join(repo,'lib/container-policy/worker.ts'));await fs.access(worker);
const runId=randomUUID(),startedAt=Date.now();
const artifactRoot=path.join(repo,'.artifacts/container-policy-replacement'),artifact=path.join(artifactRoot,runId);
await fs.mkdir(artifact,{recursive:true});
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'policy-replacement-'));
const log=await fs.open(path.join(artifact,'fixture.log'),'w'),ledger=path.join(artifact,'ledger.jsonl');
const pg=process.env.POSTGRES_BIN??'/opt/homebrew/opt/postgresql@17/bin',rest=process.env.POSTGREST_BIN??'postgrest';
const socket=path.join(directory,'socket'),connection=`host=${socket} dbname=postgres`;
const jwtSecret=randomBytes(32).toString('hex'),sessionSecret=randomBytes(32).toString('hex');
const encoded=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const payload=`${encoded({alg:'HS256',typ:'JWT'})}.${encoded({role:'service_role',exp:Math.floor(Date.now()/1000)+900})}`;
const serviceToken=`${payload}.${createHmac('sha256',jwtSecret).update(payload).digest('base64url')}`;
const children=new Set(),generations={},phases=[],checks=[],snapshots={};
let databaseStarted=false,proxy,passed=false,failure=null,fixtureOrigin;
const cleanEnv={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR??os.tmpdir(),NODE_ENV:'production',CI:'true'};
const sql=body=>execFileSync('psql',[connection,'-XqAt','-v','ON_ERROR_STOP=1'],{input:body,encoding:'utf8',timeout:15000,stdio:['pipe','pipe','pipe']}).trim();
const q=v=>v===null?'null':"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'";
const phase=(name,extra={})=>{const entry={at:new Date().toISOString(),elapsedMs:Date.now()-startedAt,name,...extra};phases.push(entry);console.log(JSON.stringify(entry));};
const check=(condition,label)=>{assert(condition,label);checks.push(label);};
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
function launch(command,args,env,out=log.fd,cwd=repo){const child=spawn(command,args,{cwd,env,stdio:['ignore',out,out]});children.add(child);child.once('exit',()=>children.delete(child));return child;}
async function until(fn,label,ms){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(250);}throw Error(`Timed out: ${label}`);}
async function entries(){try{return (await fs.readFile(ledger,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if(error.code==='ENOENT')return [];throw error;}}
const row=id=>JSON.parse(sql(`select row_to_json(b) from container_policy_builds b where id=${q(id)}`));
const count=(table,where)=>Number(sql(`select count(*) from ${table} where ${where}`));
const lease=setTimeout(()=>{failure??='Fixture lease expired';for(const child of children)child.kill('SIGKILL');},285000);

/** Start one worker generation with the fixture env. Output goes to its own log. */
async function startGeneration(name,minutes=1){
 const out=await fs.open(path.join(artifact,`generation-${name}.log`),'w');
 const env={...cleanEnv,SUPABASE_URL:fixtureOrigin,SUPABASE_SERVICE_ROLE_KEY:serviceToken,SESSION_SECRET:sessionSecret,POLICY_ARTIFACT_BUCKET:'fixture-artifacts',FIXTURE_LEDGER:ledger,FIXTURE_GENERATION:name,FIXTURE_HOLD_MS:'30000',FIXTURE_PASS_INTERVAL_MS:'2000'};
 const child=launch(process.execPath,['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',worker,`--duration-minutes=${minutes}`],env,out.fd);
 const record={pid:child.pid,startedAt:new Date().toISOString(),signaledAt:null,exitedAt:null,exitCode:null,signalCode:null,drainMs:null,child,out};
 child.once('exit',(code,signal)=>{record.exitedAt=new Date().toISOString();record.exitCode=code;record.signalCode=signal;if(record.signaledAt)record.drainMs=Date.parse(record.exitedAt)-Date.parse(record.signaledAt);});
 generations[name]=record;phase('generation.start',{generation:name,pid:child.pid});return record;
}
/** SIGTERM one generation, as a pod termination would, and wait for close. */
async function terminate(name,budgetMs){
 const record=generations[name];if(record.child.exitCode!==null||record.child.signalCode!==null)return record;
 const done=once(record.child,'exit');record.signaledAt=new Date().toISOString();record.child.kill('SIGTERM');
 await Promise.race([done,delay(budgetMs)]);
 if(record.child.exitCode===null&&record.child.signalCode===null){record.child.kill('SIGKILL');await done;throw Error(`Generation ${name} did not drain within ${budgetMs}ms`);}
 await record.out.close();phase('generation.exit',{generation:name,pid:record.pid,exitCode:record.exitCode,signalCode:record.signalCode,drainMs:record.drainMs});return record;
}
const byGeneration=(list,name)=>list.filter(e=>e.generation===name);

const league='league_1bccc63d-cd0a-47d7-92d7-e762797b5f1c',coworld='cow_a4b2ceaf-1bb7-44ec-b02e-eda696c0a324',manifest='sha256:'+'a'.repeat(64);
const files=[{path:'policy.py',content:'print("replacement fixture")\n'},{path:'Dockerfile',content:'FROM scratch\n'}];
const student='replacement-fixture-'+randomUUID(),project=randomUUID(),revision=randomUUID();
let build=null,createdSession=null;
try{
 phase('database.start');
 await fs.mkdir(socket);execFileSync(path.join(pg,'initdb'),['-D',path.join(directory,'data'),'-A','trust','--no-locale','--encoding=UTF8'],{timeout:60000,stdio:['ignore',log.fd,log.fd]});
 execFileSync(path.join(pg,'pg_ctl'),['-D',path.join(directory,'data'),'-l',path.join(directory,'postgres.log'),'-o',`-k ${socket} -c listen_addresses=''`,'-w','start'],{timeout:60000,stdio:['ignore',log.fd,log.fd]});databaseStarted=true;
 sql('create role anon;create role authenticated;create role service_role bypassrls;alter default privileges in schema public grant all on tables to service_role,anon,authenticated;');
 execFileSync(process.execPath,['scripts/migrate-db.mjs'],{cwd:repo,env:{...cleanEnv,POSTGRES_URL_NON_POOLING:connection},timeout:120000,stdio:['ignore',log.fd,log.fd]});
 phase('database.migrated');
 const restPort=await port();launch(rest,[],{...cleanEnv,PGRST_DB_URI:`postgresql:///postgres?host=${encodeURIComponent(socket)}`,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:jwtSecret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(restPort)});
 proxy=http.createServer((req,res)=>{
  if(!req.url.startsWith('/rest/v1/')){res.writeHead(404).end();return;}
  const upstream=http.request({hostname:'127.0.0.1',port:restPort,path:req.url.slice('/rest/v1'.length),method:req.method,headers:{...req.headers,host:`127.0.0.1:${restPort}`}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end();});req.pipe(upstream);
 });await new Promise(r=>proxy.listen(0,'127.0.0.1',r));fixtureOrigin=`http://127.0.0.1:${proxy.address().port}`;
 await until(async()=>{try{return(await fetch(fixtureOrigin+'/rest/v1/',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},'PostgREST',20000);
 phase('journal.ready');
 const rpc=async(name,args)=>{const response=await fetch(`${fixtureOrigin}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:serviceToken,Authorization:`Bearer ${serviceToken}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});const value=await response.json();if(!response.ok)throw Error(`${name}: ${value.message??response.status}`);return value;};

 // Seed one student, one revision and one admitted build through the same
 // service-role RPCs lib/container-policy/store.ts uses. The worker identity is
 // derived from the deployed worker bundle so command admission matches.
 const bundleHash=async name=>createHash('sha256').update(await fs.readFile(path.join(repo,'workers/policy-build',name))).digest('hex');
 const workerIdentity={workerSha256:await bundleHash('worker.mjs'),inspectorSha256:await bundleHash('inspect_oci.py'),installSha256:await bundleHash('install.sh')};
 sql(`insert into students(subject_id,email,sealed_token) values(${q(student)},'replacement-fixture@example.test','unused');`);
 const saved=await rpc('container_policy_save',{p_student:student,p_project:project,p_revision:revision,p_parent:null,p_league:league,p_coworld:coworld,p_manifest:manifest,p_title:'Replacement fixture',p_dockerfile:'Dockerfile',p_files:files});
 check(saved.id===revision&&saved.student_id===student&&saved.league_id===league,'Revision saved through container_policy_save');
 build=await rpc('container_policy_build_admit',{p_student:student,p_revision:revision,p_key:'replacement-fixture-'+runId,p_worker:workerIdentity});
 check(build.state==='queued'&&build.provider_name==='preston-policy-build-'+build.id&&build.provision_token===null,'Build admitted queued through container_policy_build_admit with no provider work');
 snapshots.seeded=row(build.id);check(snapshots.seeded.provider_session_id===null&&snapshots.seeded.job_until===null&&snapshots.seeded.cleanup_confirmed_at===null,'Seeded build has no provider session or lease');
 phase('build.admitted',{buildId:build.id,providerName:build.provider_name});

 // Generation A: real loop claims the SQL job, creates the (fake) provider once,
 // records its session, admits the command and parks inside gateway.start while
 // holding the job lease.
 await startGeneration('A');
 await until(async()=>(await entries()).some(e=>e.generation==='A'&&e.event==='gateway.start'&&e.build===build.id),'generation A creates the builder and parks in the command gateway',45000);
 const afterCreate=await entries();createdSession=afterCreate.find(e=>e.event==='provider.created'&&e.build===build.id)?.sessionId;
 check(typeof createdSession==='string'&&createdSession.startsWith('sbx_fixture_'),'Provider create journaled one physical session');
 check(afterCreate.filter(e=>e.event==='provider.create').length===1,'Exactly one provider create after generation A');
 snapshots.leaseHeldByA=row(build.id);
 check(snapshots.leaseHeldByA.provider_name===build.provider_name&&snapshots.leaseHeldByA.provider_session_id===createdSession&&snapshots.leaseHeldByA.provider_status==='running','Journal binds the original provider name and session');
 check(snapshots.leaseHeldByA.job_token!==null&&Date.parse(snapshots.leaseHeldByA.job_until)>Date.now()&&snapshots.leaseHeldByA.creation_job_token===snapshots.leaseHeldByA.job_token,'Generation A holds an unexpired job lease and the creation job token');
 check(snapshots.leaseHeldByA.state==='building'&&count('container_policy_commands',`build_id=${q(build.id)}`)===1,'One command admitted under the original session');
 const command=JSON.parse(sql(`select row_to_json(c) from container_policy_commands c where build_id=${q(build.id)}`));
 check(command.provider_session_id===createdSession&&command.admission_job===snapshots.leaseHeldByA.job_token&&command.command_id===null,'Command row bound to the original session and A job; no handle yet');
 phase('lease.held',{jobUntil:snapshots.leaseHeldByA.job_until,session:createdSession});

 // Generation B starts while A still holds the lease. It must not touch the build.
 await startGeneration('B');
 await until(async()=>byGeneration(await entries(),'B').filter(e=>e.event==='pass').length>=2,'generation B completes two passes while A holds the lease',30000);
 const concurrent=row(build.id);const bEntries=byGeneration(await entries(),'B');
 check(Date.parse(concurrent.job_until)>Date.now()&&concurrent.job_token===snapshots.leaseHeldByA.job_token,'A still holds the same unexpired lease after B passes');
 check(bEntries.every(e=>!['reconcile.begin','provider.create','provider.observe','gateway.start','gateway.observe'].includes(e.event)),'B never reconciled, observed or created while the lease was held');
 check(bEntries.filter(e=>e.event==='pass').every(e=>e.scopes===0&&e.builds===0&&e.errors===0),'B passes saw zero due scopes and zero builds');
 await terminate('B',30000);check(generations.B.exitCode===0&&generations.B.signalCode===null,'B drained on SIGTERM with exit 0');
 snapshots.afterB=row(build.id);check(snapshots.afterB.job_token===snapshots.leaseHeldByA.job_token&&snapshots.afterB.provider_session_id===createdSession,'Terminating B changed nothing in the journal');

 // Pod termination of A mid-call: the parked gateway call aborts, the job is
 // finished as uncertain, and the process exits 0 without a second effect.
 await terminate('A',30000);check(generations.A.exitCode===0&&generations.A.signalCode===null,'A drained on SIGTERM with exit 0 within budget');
 const aEntries=byGeneration(await entries(),'A');
 check(aEntries.some(e=>e.event==='signal'&&e.signal==='SIGTERM')&&aEntries.some(e=>e.event==='exit'&&e.code===0),'A journaled SIGTERM then clean exit');
 check(aEntries.some(e=>e.event==='gateway.start.aborted')||aEntries.some(e=>e.event==='gateway.started'),'A parked call ended by abort or hold expiry');
 snapshots.afterA=row(build.id);
 check(snapshots.afterA.job_token===null&&snapshots.afterA.job_until===null&&Date.parse(snapshots.afterA.next_at)>Date.now(),'A released its lease on exit and the build waits for its next SQL cadence');
 check(snapshots.afterA.state==='building'&&snapshots.afterA.cleanup_confirmed_at===null&&snapshots.afterA.provider_session_id===createdSession&&snapshots.afterA.provision_token===snapshots.leaseHeldByA.provision_token,'Build stays active with the original provider identity after A exits');
 phase('replacement.window',{nextAt:snapshots.afterA.next_at,message:snapshots.afterA.message});

 // Generation C is the replacement pod. It waits for the real SQL next_at
 // cadence (one minute), then observes the original builder and command without
 // recreating; two minutes of lifetime cover that cadence plus one pass.
 await startGeneration('C',2);
 await until(async()=>byGeneration(await entries(),'C').some(e=>e.event==='reconcile.end'&&e.build===build.id),'generation C reconciles the original build after next_at',110000);
 const all=await entries(),cEntries=byGeneration(all,'C');
 const observed=cEntries.find(e=>e.event==='provider.observe'&&e.build===build.id);
 check(observed?.found===true&&observed.sessionId===createdSession,'C observed the original session through the provider instead of creating');
 check(!cEntries.some(e=>['provider.create','gateway.start'].includes(e.event)),'C issued no provider create and no command start');
 const cEnd=cEntries.find(e=>e.event==='reconcile.end'&&e.build===build.id);
 check(cEntries.filter(e=>e.event==='gateway.observe'&&e.build===build.id).length===1&&cEnd.state==='ready'&&cEnd.command==='waiting','C found the builder ready, observed the original command once and left it waiting');
 check(all.filter(e=>e.event==='provider.create').length===1&&all.filter(e=>e.event==='gateway.start').length===1&&all.filter(e=>e.event==='provider.stop').length===0,'Whole run: one provider create, one command start, zero stops');
 check(!all.some(e=>['collect.unexpected','transfer.unexpected','reconcile.error'].includes(e.event)),'No collection, retention or controller error occurred');
 snapshots.afterC=row(build.id);
 check(snapshots.afterC.id===build.id&&snapshots.afterC.provider_name===build.provider_name&&snapshots.afterC.provider_session_id===createdSession&&snapshots.afterC.provision_token===snapshots.leaseHeldByA.provision_token&&snapshots.afterC.creation_job_token===snapshots.leaseHeldByA.job_token,'Build id, provider name, session, provision token and creation job are unchanged after replacement');
 check(snapshots.afterC.state==='building'&&snapshots.afterC.cleanup_confirmed_at===null&&snapshots.afterC.failures===0&&snapshots.afterC.job_token===null,'Replacement pass finished cleanly and the build remains active');
 check(snapshots.afterC.message==='Original command receipt is not visible; no replacement command was started','Replacement journaled the original-command-only outcome');
 const commandAfter=JSON.parse(sql(`select row_to_json(c) from container_policy_commands c where build_id=${q(build.id)}`));
 const journalCounts={builds:count('container_policy_builds',`student_id=${q(student)}`),commands:count('container_policy_commands',`student_id=${q(student)}`),uploads:count('container_policy_uploads',`student_id=${q(student)}`),transfers:count('container_policy_transfers',`student_id=${q(student)}`),practices:count('container_policy_practices',`student_id=${q(student)}`)};
 check(journalCounts.builds===1&&journalCounts.commands===1&&journalCounts.uploads===0&&journalCounts.transfers===0&&journalCounts.practices===0,'One build row, one command row, no uploads, transfers or practices');
 check(commandAfter.command_token===command.command_token&&commandAfter.provider_session_id===createdSession&&commandAfter.admission_job===command.admission_job&&commandAfter.state==='admitted','Command token, session and admission job are unchanged; no second registration');
 const budget=JSON.parse(sql(`select research_daily_budget(${q(student)})`));
 check(Number(budget.reservedUsd)===1,'Exactly one compute reservation remains held across replacement');
 snapshots.journalCounts=journalCounts;snapshots.budgetReservedUsd=Number(budget.reservedUsd);snapshots.command={before:command,after:commandAfter};
 await terminate('C',30000);check(generations.C.exitCode===0&&generations.C.signalCode===null,'C drained on SIGTERM with exit 0');
 passed=true;phase('passed',{checks:checks.length});
}catch(error){
 failure=failure??(error instanceof Error?error.message:String(error));phase('failed',{failure});
}finally{
 clearTimeout(lease);
 for(const child of [...children]){if(child.exitCode!==null||child.signalCode!==null)continue;const done=once(child,'exit');child.kill('SIGTERM');await Promise.race([done,delay(5000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await done;}}
 for(const record of Object.values(generations))await record.out.close().catch(()=>{});
 if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}
 if(databaseStarted)try{execFileSync(path.join(pg,'pg_ctl'),['-D',path.join(directory,'data'),'-m','fast','-w','stop'],{timeout:30000,stdio:['ignore',log.fd,log.fd]});}catch{}
 await log.close();await fs.rm(directory,{recursive:true,force:true});
 const sourceFiles=['lib/container-policy/worker.ts','lib/container-policy/dispatch.ts','lib/container-policy/controller.ts','lib/container-policy/recovery.ts','lib/container-policy/commands.ts','lib/container-policy/store.ts','lib/container-policy/storage-config.ts','lib/db.ts','workers/policy-build/worker.mjs','workers/policy-build/storage.mjs','scripts/container-policy-worker.mjs','tests/runtime/container-policy-replacement-worker.mjs','tests/runtime/container-policy-replacement.mjs',...(await fs.readdir(path.join(repo,'supabase/migrations'))).filter(f=>f.includes('container_policy')).map(f=>'supabase/migrations/'+f)];
 const sourceHashes={};for(const file of sourceFiles)sourceHashes[file]=createHash('sha256').update(await fs.readFile(path.join(repo,file))).digest('hex');
 const ledgerEntries=await entries();
 const summary={generation:name=>{const r=generations[name];return r?{pid:r.pid,startedAt:r.startedAt,signaledAt:r.signaledAt,exitedAt:r.exitedAt,exitCode:r.exitCode,signalCode:r.signalCode,drainMs:r.drainMs,passes:ledgerEntries.filter(e=>e.generation===name&&e.event==='pass').length}:null;}};
 const report={
  runId,passed,failure,startedAt:new Date(startedAt).toISOString(),finishedAt:new Date().toISOString(),durationMs:Date.now()-startedAt,
  command:'node tests/runtime/container-policy-replacement.mjs',
  build:build?{id:build.id,studentId:student,leagueId:league,revisionId:revision,providerName:build.provider_name,providerSessionId:createdSession,provisionToken:snapshots.leaseHeldByA?.provision_token??null,creationJobToken:snapshots.leaseHeldByA?.job_token??null}:null,
  providerCalls:{create:ledgerEntries.filter(e=>e.event==='provider.create').length,observe:Object.fromEntries(['A','B','C'].map(n=>[n,ledgerEntries.filter(e=>e.generation===n&&e.event==='provider.observe').length])),stop:ledgerEntries.filter(e=>e.event==='provider.stop').length,gatewayStart:ledgerEntries.filter(e=>e.event==='gateway.start').length,gatewayStartAborted:ledgerEntries.filter(e=>e.event==='gateway.start.aborted').length,gatewayObserve:ledgerEntries.filter(e=>e.event==='gateway.observe').length},
  generations:{A:summary.generation('A'),B:summary.generation('B'),C:summary.generation('C')},
  snapshots,checks,phases,
  real:['lib/container-policy/worker.ts runContainerBuildWorker loop, SIGTERM/deadline handling mirrored from scripts/container-policy-worker.mjs','dueContainerScopes SQL discovery and containerDispatchCandidates (lib/container-policy/dispatch.ts) through supabase-js against PostgREST','createContainerBuildDispatcher and reconcileHostedBuild (controller.ts)','reconcileContainerProvider and recoveryStore RPCs (recovery.ts): container_policy_build_job, _allowed, _provider, _not_started, _job_finish','advanceContainerCommand, commandStore and trustedBuildBundle (commands.ts): container_policy_command_claim, _allowed, _handle; ownedContainerRevision identity verification (store.ts, workers/policy-build/worker.mjs buildIdentity)','containerStorageFromEnvironment (storage-config.ts) constructed with the fixture origin; never used for network','lib/db.ts Supabase client; every supabase/migrations/*.sql applied by scripts/migrate-db.mjs to a disposable PostgreSQL 17 served by local PostgREST','Admission via the same service-role RPCs store.ts calls: container_policy_save and container_policy_build_admit'],
  fake:['BuildProvider create/observe/stop: journals to ledger.jsonl; observe returns only a session that create journaled','CommandGateway start: parks for FIXTURE_HOLD_MS so the job lease stays held, aborts on SIGTERM; observe: never returns a receipt','collectContainerArchive and TransferStore: throw if reached (never reached)','Worker rest between passes shortened from 60 s to FIXTURE_PASS_INTERVAL_MS; SQL next_at/job_until still gate every build'],
  notProven:['No real Vercel Sandbox, image build, archive collection, retention, upload, registry registration or practice run','No Kubernetes: process SIGTERM stands in for pod termination; Recreate ordering and 150 s terminationGracePeriod are not exercised','The shipped entry scripts/container-policy-worker.mjs is not executed because it constructs the real provider at module scope; this fixture mirrors its main() with injected ports','No hosted database, credentials or the user\'s running local supervisor were touched'],
  toolchain:{node:process.version,postgresBin:pg,postgrest:rest},
  files:{ledger:'ledger.jsonl',fixtureLog:'fixture.log',generationLogs:['generation-A.log','generation-B.log','generation-C.log']},
  sourceHashes,
 };
 await fs.writeFile(path.join(artifact,'report.json'),JSON.stringify(report,null,2));
 // Belt and braces: no fixture credential may appear in any evidence file.
 const leaked=[];for(const file of await fs.readdir(artifact)){const text=await fs.readFile(path.join(artifact,file),'utf8');if([serviceToken,jwtSecret,sessionSecret].some(secret=>text.includes(secret)))leaked.push(file);}
 for(const file of leaked)await fs.rm(path.join(artifact,file));
 if(leaked.length){passed=false;await fs.writeFile(path.join(artifact,'report.json'),JSON.stringify({...report,passed:false,failure:'Evidence file contained a fixture credential and was removed: '+leaked.join(', ')},null,2));}
 const readme=`# Hosted build worker replacement fixture

Latest run: ${passed?'PASS':'FAIL'} (${new Date().toISOString()}, ${Math.round(report.durationMs/1000)} s) — [${runId}/report.json](${runId}/report.json).
${failure?`\nFailure: ${failure}\n`:''}
Run from the repository root with no \`.env\` file: \`node tests/runtime/container-policy-replacement.mjs\`.
It needs \`/opt/homebrew/opt/postgresql@17/bin\` (or \`POSTGRES_BIN\`), \`psql\` and \`postgrest\` on PATH. It finishes in under five minutes, starts its own PostgreSQL/PostgREST, and removes them in \`finally\`.

## What it proves

Three generations of \`tests/runtime/container-policy-replacement-worker.mjs\` run the real \`runContainerBuildWorker\` loop, dispatcher, controller, recovery store and command store against a disposable journal with every migration applied. One build is admitted through the same service-role RPCs the app uses.

- Generation A (pid ${report.generations.A?.pid??'n/a'}) claimed the SQL job, created the builder once (${report.providerCalls.create} create call), recorded session \`${createdSession??'n/a'}\`, admitted the command and parked while holding \`job_until\`.
- Generation B (pid ${report.generations.B?.pid??'n/a'}) started while A held the lease: ${report.generations.B?.passes??0} passes, zero due scopes, zero provider or gateway calls. Exit ${report.generations.B?.exitCode??'n/a'}.
- A received SIGTERM mid-call and exited ${report.generations.A?.exitCode??'n/a'} in ${report.generations.A?.drainMs??'n/a'} ms; its lease was released as uncertain, nothing was recreated.
- Generation C (pid ${report.generations.C?.pid??'n/a'}) waited for the real \`next_at\` cadence, observed the same session (${report.providerCalls.observe.C} observe, 0 create, 0 command start), and left the original command waiting. Exit ${report.generations.C?.exitCode??'n/a'}.
- Final journal: ${snapshots.journalCounts?`${snapshots.journalCounts.builds} build, ${snapshots.journalCounts.commands} command, ${snapshots.journalCounts.uploads} uploads, ${snapshots.journalCounts.transfers} transfers, ${snapshots.journalCounts.practices} practices`:'not reached'}; reservation held: ${snapshots.budgetReservedUsd??'n/a'} USD. Build id, provider name, session, provision token, creation job token and command token unchanged.

${checks.length} checks passed; see \`checks\` in the report.

## Real versus fake

Real: ${report.real.map(v=>`\n- ${v}`).join('')}

Fake: ${report.fake.map(v=>`\n- ${v}`).join('')}

## Not proven

${report.notProven.map(v=>`- ${v}`).join('\n')}

Evidence per run: \`report.json\`, \`ledger.jsonl\` (provider/gateway effects by generation and pid), \`fixture.log\`, \`generation-{A,B,C}.log\`. No credentials are written; the fixture removes any evidence file that contains one.
`;
 await fs.writeFile(path.join(artifactRoot,'README.md'),readme);
 console.log(JSON.stringify({passed,failure,artifact,checks:checks.length,durationMs:report.durationMs}));
 process.exitCode=passed?0:1;
}
