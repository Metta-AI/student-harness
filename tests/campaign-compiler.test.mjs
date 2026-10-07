import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createHash} from 'node:crypto';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
let ready=true;
mock.module('../lib/campaigns/audit-vm.ts',{namedExports:{auditVM:async()=>({ready,endpoint:'https://audit.test',key:'private'}),recordAuditJob:async()=>{}}});
const {validatePolicySource,readReplayAudit}=await import('../lib/campaigns/worker.ts');
const release={fingerprint:'release',sourceUrl:'pinned'},scope={studentId:'owner'},source='end';
const receipt={valid:true,sourceHash:createHash('sha256').update(source).digest('hex'),release:'release',compilerHash:'a'.repeat(64)};
test('candidate compilation preserves compiler rejections and binds the receipt to source and release',async()=>{
 const original=globalThis.fetch;
 try{
 globalThis.fetch=async(url,options)=>{assert.equal(url.pathname,'/validate');assert.equal(options.headers.Authorization,'Bearer private');assert.deepEqual(JSON.parse(options.body),{release,source});return Response.json({...receipt,valid:false,error:'global count exceeds limit'});};
 assert.equal((await validatePolicySource(release,source,scope)).valid,false);
 for(const patch of [{sourceHash:'wrong'},{release:'other'},{compilerHash:''},{valid:'yes'}]){
  globalThis.fetch=async()=>Response.json({...receipt,...patch});
  await assert.rejects(validatePolicySource(release,source,scope),/identity mismatch/);
 }
 globalThis.fetch=async()=>new Response('',{status:502});
 await assert.rejects(validatePolicySource(release,source,scope),/retry without starting games/);
 ready=false;globalThis.fetch=async()=>{throw Error('should not fetch');};
 await assert.rejects(validatePolicySource(release,source,scope),/preparing/);
 }finally{globalThis.fetch=original;ready=true;}
});

test('saved audit polling handles readiness, missing jobs, and terminal failures',async()=>{
 const original=globalThis.fetch,job='a'.repeat(64);
 try{
  ready=false;globalThis.fetch=async()=>{throw Error('unexpected fetch');};
  assert.equal((await readReplayAudit(release,job,'episode',scope)).status,'waiting');
  ready=true;
  await assert.rejects(readReplayAudit(release,'../other','episode',scope),/Invalid replay audit job/);
  globalThis.fetch=async(url,options)=>{assert.equal(url.pathname,`/jobs/${job}`);assert.equal(options.headers.Authorization,'Bearer private');assert.equal(options.body,undefined);return new Response('',{status:404});};
  assert.equal(await readReplayAudit(release,job,'episode',scope),null);
  globalThis.fetch=async()=>Response.json({status:'completed',result:{evidence:true}});
  assert.deepEqual(await readReplayAudit(release,job,'episode',scope),{status:'completed',result:{evidence:true},jobId:job});
  globalThis.fetch=async()=>Response.json({status:'failed',error:'wrong source'});
  await assert.rejects(readReplayAudit(release,job,'episode',scope),/audit mismatch/);
  globalThis.fetch=async()=>new Response('',{status:503});
  await assert.rejects(readReplayAudit(release,job,'episode',scope),/503/);
 }finally{globalThis.fetch=original;ready=true;}
});
