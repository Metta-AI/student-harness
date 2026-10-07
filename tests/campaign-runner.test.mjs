import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
const {hashObject}=await import('../lib/campaigns/model.ts');
let tables,campaign,study,accepted,lostReply,postCalls,engineReady,release,failure,failurePatch,lateCompletion,pendingCandidate,trackIO,activeIO,peakIO,auditState,auditReads,auditRequests,artifactReads,attemptWrites,advanceClock;
const clone=x=>structuredClone(x);
function database(){return {from(table){let filters=[],patch,upsert,columns;const q={
 select(value){columns=value;return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},gt(){return q;},
 update(p){patch=p;return q;},upsert(p){upsert=p;if(table==='research_attempts')attemptWrites++;return q;},
 maybeSingle(){return Promise.resolve({data:rows()[0]??null,error:null});},single(){return q.maybeSingle();},
 then(resolve,reject){return Promise.resolve({data:rows(),error:null}).then(resolve,reject);}
 };function rows(){const list=tables[table]??=[];if(upsert)for(const row of Array.isArray(upsert)?upsert:[upsert])if(!list.some(r=>r.request_key===row.request_key))list.push({id:`a${list.length}`,state:'created',xp_id:null,receipt:{},...clone(row)});const matches=list.filter(r=>filters.every(f=>f(r)));if(patch)matches.forEach(r=>Object.assign(r,clone(patch)));if(table==='research_attempts'&&columns==='*'&&matches.some(a=>a.result?.evidence?.native?.simulation?.subject_events))throw Error('Full replay result exceeds the poll response budget');const out=clone(matches);if(table==='research_attempts'&&columns?.includes('result:outcome_summary'))return out.map(({result,...row})=>({...row,result:result?Object.fromEntries(Object.entries(result).filter(([key])=>key!=='evidence')):null}));return out;}return q;}};}
mock.module('../lib/db.ts',{namedExports:{db:database,studentToken:async()=> 'test'}});
mock.module('../lib/tasks/store.ts',{namedExports:{rpc:async(name,p)=>{
 if(name==='research_daily_reserve')return true;
 assert.equal(name,'campaign_attempt_write');Object.assign(tables.research_attempts.find(a=>a.id===p.p_id),clone(p.p_patch),{updated_at:new Date().toISOString()});
}}});
mock.module('../lib/campaigns/store.ts',{namedExports:{checked:r=>{if(r.error)throw Error(r.error.message);return r.data;},claimStudy:async()=>['running','auditing'].includes(study.state)?clone(study):null,saveStudy:async(s,p)=>Object.assign(study,clone(p)),artifact:async()=> 'evidence',campaignById:async()=>clone(campaign)}});
mock.module('../lib/campaigns/worker.ts',{namedExports:{auditWorkerReady:async()=>engineReady,requestReplayAudit:async()=>{auditRequests++;return {status:auditState??'completed',jobId:'a'.repeat(64),result:{}};},readReplayAudit:async()=>{auditReads++;return auditState==='missing'?null:{status:auditState,jobId:'a'.repeat(64),result:{}};}}});
mock.module('../lib/campaigns/provider.ts',{namedExports:{
 currentRelease:async()=>({fingerprint:release}),episodeArtifact:async()=>{artifactReads++;return {};},
 verifyAudit:(f,hash,id)=>({episodeId:id,utility:hash==='candidate'?1:.5,win:hash==='candidate',loss:false,xp:100,score:10}),
 apiJSON:async(token,path,body)=>{
  advanceClock?.();
  if(trackIO){peakIO=Math.max(peakIO,++activeIO);await new Promise(r=>setTimeout(r,3));activeIO--;}
  if(body){postCalls++;let xp=accepted.get(body.idempotency_key);if(!xp){xp={id:`xp${accepted.size}`,request:clone(body)};accepted.set(body.idempotency_key,xp);}if(lostReply){lostReply=false;throw Error('Connection dropped after provider acceptance');}return {id:xp.id};}
  if(path.includes('/experience-requests/'))return {episodes:[{id:`ereq-${path.split('/').at(-1)}`} ]};
  const xp=[...accepted.values()].find(x=>`ereq-${x.id}`===path.split('/').at(-1));assert.ok(xp);
  if(pendingCandidate&&xp.request.idempotency_key.includes(':candidate:'))return {status:'running'};
  if(failure&&xp.request.idempotency_key.endsWith(':baseline:0')&&!lateCompletion)return {status:'error',error_type:failure,scores:[],failed_policy_index:failure==='policy_error'?0:null,...failurePatch};
  return {status:'completed',policy_version_ids:xp.request.roster.map(r=>r.player.policy_ref)};
 }
}});
const {processStudy}=await import('../lib/campaigns/studies.ts');
function setup(){
 campaign={id:'c',student_id:'owner',state:'active',league_id:'league',protocol:{concurrency:4}};
 const baseline={versionId:'b',source:'base',sourceHash:'baseline'},candidate={versionId:'n',source:'new',sourceHash:'candidate'};
 const protocol={pairs:2,baseline,candidate,release:{fingerprint:'release',coworldId:'cow'},gate:'directional'};
 study={id:'s',campaign_id:'c',student_id:'owner',task_id:'task',lease_token:'lease',cohort:'screen',state:'running',protocol,protocol_hash:hashObject(protocol),result:null};
 tables={research_studies:[study],research_attempts:[],agent_tasks:[{id:'task'}],research_fixtures:[0,1].map(i=>({id:`f${i}`,study_id:'s',fixture:{seed:i+1,slot:0,roster:Array(10).fill('r'),hashes:Array(10).fill('h'),config:{seed:i+1},release:{fingerprint:'release',coworldId:'cow'}}}))};
 accepted=new Map();postCalls=0;lostReply=false;engineReady=true;release='release';failure=null;failurePatch={};lateCompletion=false;pendingCandidate=false;trackIO=false;activeIO=0;peakIO=0;auditState=null;auditReads=0;auditRequests=0;artifactReads=0;attemptWrites=0;advanceClock=null;
}
async function tick(){tables.research_attempts.forEach(a=>a.next_at='2000-01-01');await processStudy('s');}
test('study resumes after acceptance before receipt persistence without duplicate games',async()=>{
 setup();lostReply=true;await tick();assert.equal(accepted.size,4);assert.equal(tables.research_attempts.filter(a=>a.xp_id).length,3);
 await tick();await tick();assert.equal(accepted.size,4);assert.equal(postCalls,5);assert.equal(study.state,'completed');assert.equal(study.result.pairs,2);assert.equal(study.result.passed,true);
 assert.equal(tables.research_attempts.filter(a=>a.state==='complete').length,4);
});
test('pause reconciles paid games but never starts new ones; missing audit engine spends nothing',async()=>{
 setup();engineReady=false;await tick();assert.equal(postCalls,0);engineReady=true;campaign.protocol.concurrency=1;await tick();assert.equal(postCalls,1);
 campaign.state='paused';await tick();assert.equal(postCalls,1);assert.equal(tables.research_attempts.filter(a=>a.state==='complete').length,1);assert.equal(tables.agent_tasks[0].status,'paused');
 campaign.state='active';for(let i=0;i<8;i++)await tick();assert.equal(study.state,'completed');assert.equal(accepted.size,4);
});
test('transport retries preserve fixtures; late completed failures invalidate instead of hanging',async()=>{
 setup();failure='artifact_transport_error';await tick();await tick();assert.equal(tables.research_attempts.filter(a=>a.state==='infra_failed').length,2);
 await tick();lateCompletion=true;await tick();assert.equal(study.state,'invalid');assert.match(study.result.invalidReason,/previously failed attempt completed/);assert.equal(accepted.size,6);
});
test('policy failures are not retried; release changes drain accepted work and invalidate',async()=>{
 setup();failure='policy_error';await tick();await tick();assert.equal(study.state,'invalid');assert.equal(accepted.size,4);assert.equal(tables.research_attempts.length,4);
 setup();campaign.protocol.concurrency=1;await tick();release='new-release';await tick();assert.equal(accepted.size,1);assert.equal(study.state,'invalid');assert.match(study.result.invalidReason,/release changed/);
});

test('transport errors with any score or policy attribution cannot be replaced',async()=>{
 for(const patch of [{participant_scores:[{position:0,score:0}]},{scores:[{score:0}]},{failed_agent_index:0},{failed_policy_version_id:'policy'}]){
  setup();failure='artifact_transport_error';failurePatch=patch;await tick();await tick();
  assert.equal(study.state,'invalid');assert.equal(accepted.size,4);assert.equal(tables.research_attempts.length,4);
 }
});
test('late scores or reclassified failures invalidate even if original status never becomes completed',async()=>{
 for(const patch of [{participant_scores:[{position:0,score:0}]},{error_type:'policy_error'},{status:'running'}]){
  setup();failure='artifact_transport_error';await tick();await tick();await tick();failurePatch=patch;await tick();
  assert.equal(study.state,'invalid');assert.match(study.result.invalidReason,/no longer an unscored transport failure/);
  assert.ok(tables.research_attempts.some(a=>a.receipt.lateReconciliation));
 }
});
test('runner cools new submissions during a host outage and resumes the exact pending attempts',async()=>{
 setup();campaign.protocol.concurrency=8;study.protocol.pairs=4;study.protocol_hash=hashObject(study.protocol);
 tables.research_fixtures=Array.from({length:4},(_,i)=>({...clone(tables.research_fixtures[0]),id:`f${i}`}));
 failure='artifact_transport_error';await tick();await tick();assert.equal(postCalls,8);
 assert.equal(tables.research_attempts.filter(a=>a.state==='complete').length,4);
 const pending=tables.research_attempts.filter(a=>a.state==='created').map(a=>clone(a.request));
 await tick();assert.equal(postCalls,8);assert.match(tables.agent_tasks[0].checkpoint.research_progress.summary,/Host transport cooldown/);
 for(const a of tables.research_attempts.filter(a=>a.state==='infra_failed'))a.updated_at=new Date(Date.now()-4*60_000).toISOString();
 await tick();assert.equal(postCalls,12);
 assert.deepEqual([...accepted.values()].slice(8).map(a=>a.request),pending);
 await tick();assert.equal(study.state,'completed');assert.equal(study.result.pairs,4);
});

test('an invalid arm drains in-flight work without submitting the rest of the study',async()=>{
 setup();campaign.protocol.concurrency=2;failure='policy_error';pendingCandidate=true;
 await tick();await tick();assert.equal(accepted.size,2);assert.notEqual(study.state,'completed');
 await tick();assert.equal(accepted.size,2);assert.match(study.result.invalidReason,/valid comparison/);
 pendingCandidate=false;await tick();assert.equal(study.state,'invalid');assert.equal(accepted.size,2);
});

test('twenty-four hosted slots use bounded reconciliation I/O and persist current host receipts',async()=>{
 setup();campaign.protocol.concurrency=24;study.protocol.pairs=12;study.protocol_hash=hashObject(study.protocol);
 tables.research_fixtures=Array.from({length:12},(_,i)=>({...clone(tables.research_fixtures[0]),id:`f${i}`}));
 trackIO=true;await tick();assert.equal(accepted.size,24);assert.equal(peakIO,4);
 await tick();assert.equal(study.state,'completed');assert.equal(peakIO,4);
 assert.ok(tables.research_attempts.every(a=>a.receipt.episode.status==='completed'));
});

test('pending audits poll saved jobs without downloading artifacts; lost jobs recover',async()=>{
 setup();auditState='queued';await tick();await tick();
 assert.equal(artifactReads,16);assert.equal(auditRequests,4);
 assert.ok(tables.research_attempts.every(a=>a.state==='auditing'));
 await tick();assert.equal(auditReads,4);assert.equal(artifactReads,16);assert.equal(auditRequests,4);
 auditState='missing';await tick();assert.equal(auditReads,8);assert.equal(artifactReads,32);assert.equal(auditRequests,8);
 auditState='completed';await tick();assert.equal(artifactReads,48);assert.equal(auditRequests,8);
 assert.equal(study.state,'completed');assert.equal(study.result.pairs,2);
});

test('large studies insert missing attempts once and recover a partial queue without rewriting receipts',async()=>{
 setup();study.protocol.pairs=128;study.protocol_hash=hashObject(study.protocol);
 tables.research_fixtures=Array.from({length:128},(_,i)=>({...clone(tables.research_fixtures[0]),id:`f${i}`}));
 await tick();assert.equal(attemptWrites,1);assert.equal(tables.research_attempts.length,256);
 const receipt=clone(tables.research_attempts.find(a=>a.xp_id));
 tables.research_attempts=tables.research_attempts.filter(a=>a.fixture_id!=='f127');
 await tick();assert.equal(attemptWrites,2);assert.equal(tables.research_attempts.length,256);
 assert.equal(tables.research_attempts.find(a=>a.id===receipt.id).xp_id,receipt.xp_id);
 await tick();assert.equal(attemptWrites,2);
});

 test('completed evidence stays stored while polling reads only outcome summaries',async()=>{
 setup();await tick();await tick();const expected=clone(study.result);
 for(const a of tables.research_attempts)a.result.evidence={native:{simulation:{subject_events:['large immutable replay ledger']}}};
 study.state='auditing';await tick();assert.equal(study.state,'completed');assert.deepEqual(study.result,expected);
 assert.ok(tables.research_attempts.every(a=>a.result.evidence.native.simulation.subject_events.length===1));
 });

 test('slow batches checkpoint before the lease deadline and resume unstarted requests',async()=>{
 setup();campaign.protocol.concurrency=24;study.protocol.pairs=12;study.protocol_hash=hashObject(study.protocol);
 tables.research_fixtures=Array.from({length:12},(_,i)=>({...clone(tables.research_fixtures[0]),id:`f${i}`}));
 let now=Date.now();const clock=mock.method(Date,'now',()=>now);
 try{
  advanceClock=()=>{now+=60_000;};await tick();
  assert.ok(accepted.size>0&&accepted.size<24);assert.equal(tables.research_attempts.length,24);
  assert.match(tables.agent_tasks[0].checkpoint.research_progress.summary,/0\/12 pairs/);
  assert.equal(study.state,'running');advanceClock=null;
  await tick();await tick();assert.equal(study.state,'completed');assert.equal(accepted.size,24);assert.equal(postCalls,24);
 }finally{clock.mock.restore();}
 });

test('free hosted slots fill before expensive reconciliation exhausts the poll deadline',async()=>{
 setup();study.protocol.pairs=12;study.protocol_hash=hashObject(study.protocol);
 tables.research_fixtures=Array.from({length:12},(_,i)=>({...clone(tables.research_fixtures[0]),id:`f${i}`}));
 campaign.protocol.concurrency=2;await tick();assert.equal(accepted.size,2);
 campaign.protocol.concurrency=24;let now=Date.now();const clock=mock.method(Date,'now',()=>now);
 try{
  advanceClock=()=>{now+=60_000;};await tick();assert.ok(accepted.size>2);
  advanceClock=null;await tick();await tick();assert.equal(study.state,'completed');
  assert.equal(accepted.size,24);assert.equal(postCalls,24);
 }finally{clock.mock.restore();}
});
