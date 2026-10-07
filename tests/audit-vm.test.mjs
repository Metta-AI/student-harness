import {test,mock} from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
let tables,opens,stops,commands,missing,artifacts;
function db(){return {from(table){let filters=[],patch,upsert;const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},not(k,op,v){const excluded=v.slice(1,-1).split(',');filters.push(r=>!excluded.includes(r[k]));return q;},update(p){patch=p;return q;},upsert(p){upsert=p;return q;},single(){return Promise.resolve({data:rows()[0]??null});},then(resolve,reject){return Promise.resolve({data:rows()}).then(resolve,reject);}};
 function rows(){if(upsert){let row=tables[table].find(r=>r.audit_session_id===upsert.audit_session_id&&r.job_id===upsert.job_id);if(row)Object.assign(row,upsert);else tables[table].push(upsert);upsert=null;}const matches=tables[table].filter(r=>filters.every(f=>f(r)));if(patch)matches.forEach(r=>Object.assign(r,structuredClone(patch)));return structuredClone(matches);}return q;}};}
const sandbox={writeFiles:async()=>{},readFileToBuffer:async({path})=>Buffer.from(path.endsWith('engines.json')?'{"release":{"validatorBinary":"compiler","probeBinary":"probe"}}':'{"state":"ready"}'),runCommand:async(...args)=>{commands.push(args);return {exitCode:0};},stop:async()=>{stops++;},domain:()=> 'https://auditor.test'};
mock.module('@vercel/sandbox',{namedExports:{Sandbox:{getOrCreate:async()=>{opens++;await new Promise(r=>setTimeout(r,5));return sandbox;},get:async()=>{if(missing)throw Object.assign(Error('Not found'),{response:{status:404}});return sandbox;}}}});
mock.module('../lib/db.ts',{namedExports:{db}});
mock.module('../lib/crypto.ts',{namedExports:{sealJson:()=> 'sealed',unsealJson:()=>({key:'test-key'})}});
mock.module('../lib/tasks/store.ts',{namedExports:{rpc:async(name,args)=>{assert.equal(name,'audit_session_create');assert.equal(args.p_student,'owner');return structuredClone(tables.research_audit_sessions[0]);}}});
mock.module('../lib/campaigns/store.ts',{namedExports:{checked:r=>{if(r.error)throw Error(r.error.message);return r.data;},artifact:async(...args)=>artifacts.push(args)}});
mock.module('../lib/league-catalog.ts',{namedExports:{defaultLeagueId:'league-test'}});
const {auditVM,controlAuditSession,recordAuditJob}=await import('../lib/campaigns/audit-vm.ts');
function setup(){tables={research_audit_sessions:[{id:'audit',student_id:'owner',task_id:'task',vm_name:'own-vm',sealed_key:'sealed',state:'ready',release:{fingerprint:'release'}}],agent_tasks:[{id:'task',status:'waiting'}],research_audit_jobs:[]};opens=stops=0;commands=[];artifacts=[];missing=false;}
test('concurrent audit requests reuse one VM and paused sessions never provision compute',async()=>{
 setup();await Promise.all([auditVM({fingerprint:'release'},{studentId:'owner',taskId:'parent'}),auditVM({fingerprint:'release'},{studentId:'owner',taskId:'parent'})]);assert.equal(opens,1);
 tables.research_audit_sessions[0].state='paused';const paused=await auditVM({fingerprint:'release'},{studentId:'owner',taskId:'parent'});assert.equal(paused.endpoint,'');assert.equal(opens,1);
});
test('active auditors renew an expiring VM without replacing its persisted jobs',async()=>{
 setup();let renewed=0;sandbox.expiresAt=new Date(Date.now()+60000);sandbox.extendTimeout=async ms=>{renewed++;assert.equal(ms,30*60*1000);};
 try{await auditVM({fingerprint:'release'},{studentId:'owner',taskId:'parent'});assert.equal(renewed,1);assert.equal(stops,0);
 sandbox.expiresAt=new Date(Date.now()+25*60*1000);await auditVM({fingerprint:'release'},{studentId:'owner',taskId:'parent'});assert.equal(renewed,1);
 }finally{delete sandbox.expiresAt;delete sandbox.extendTimeout;}
});
test('pause and resume preserve the audit session without launching a chat or rebuilding its engine',async()=>{
 setup();await controlAuditSession('owner','task','pause','Wait');assert.equal(stops,1);assert.equal(tables.agent_tasks[0].status,'paused');
 await controlAuditSession('owner','task','resume','');assert.equal(tables.agent_tasks[0].status,'waiting');assert.equal(tables.research_audit_sessions[0].state,'starting');assert.equal(commands.length,0);assert.equal(tables.agent_tasks[0].next_check_at,'2100-01-01T00:00:00Z');
 missing=true;await controlAuditSession('owner','task','cancel','');assert.equal(tables.agent_tasks[0].status,'canceled');assert.equal(tables.research_audit_sessions[0].state,'canceled');
});
test('audit receipts survive parent cancellation and publish evidence without resuming a paused auditor',async()=>{
 setup();tables.agent_tasks[0].status='paused';const a=tables.research_audit_sessions[0];
 await recordAuditJob(a,'job','ereq-one',{status:'running'});
 await recordAuditJob(a,'job','ereq-one',{status:'completed',result:{vm:{validated_hashes:1440}}});
 assert.equal(tables.research_audit_jobs.length,1);assert.equal(tables.research_audit_jobs[0].state,'completed');assert.equal(tables.agent_tasks[0].status,'paused');assert.equal(artifacts.length,1);assert.equal(artifacts[0][5].taskId,'task');
});

test('candidate probe receipts remain distinct from verified replay evidence',async()=>{
 setup();await recordAuditJob(tables.research_audit_sessions[0],'probe-job','ereq-one',{status:'completed',result:{kind:'candidate-prefix-probe',probe:{first_divergence_tick:10}}});
 assert.equal(artifacts[0][2],'candidate-probe');assert.equal(artifacts[0][4].audit,undefined);assert.equal(artifacts[0][4].diagnostic.status,'completed');
});
