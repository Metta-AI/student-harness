import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {registerHooks} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
const children=[];
mock.module('node:child_process',{namedExports:{spawn:()=>{
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.input='';child.stdin.on('data',b=>child.input+=b.toString());child.kill=()=>{child.killed=true;child.emit('close',null);return true;};children.push(child);return child;
}}});
const {runSoftmaxCli}=await import('../lib/voice/cli.ts');
const tick=()=>new Promise(r=>setImmediate(r));
const query={program:'coworld',args:['leagues','--json']};
function finish(child,output,code=0){child.stdout.write(output);child.emit('close',code);}

test('CLI coalesces only identical credentials and commands, compacts JSON, redacts credentials, then refreshes',async()=>{
 const before=children.length;
 const a=runSoftmaxCli('secret-a',query),duplicate=runSoftmaxCli('secret-a',query),b=runSoftmaxCli('secret-b',query);
 await tick();assert.equal(children.length-before,2);assert.equal(JSON.parse(children[before].input).token,'secret-a');
 finish(children[before],'[\n  {"id": "secret-a"}\n]');finish(children[before+1],'[]');
 const results=await Promise.all([a,duplicate,b]);assert.equal(results[1].timing.reuse,'inflight');assert.equal(results[0].stdout,'[{"id":"[credential removed]"}]');assert(!JSON.stringify(results).includes('secret-a'));
 const fresh=runSoftmaxCli('secret-a',query);await tick();assert.equal(children.length-before,3);finish(children.at(-1),'[]');assert.equal((await fresh).timing.reuse,'none');
});
test('CLI subprocesses are capped; a completed process frees capacity',async()=>{
 const tasks=Array.from({length:4},(_,i)=>runSoftmaxCli(`bounded-${i}`,query));await tick();
 await assert.rejects(runSoftmaxCli('overflow',query),/busy/);
 for(const child of children.slice(-4))finish(child,'[]');await Promise.all(tasks);
 const next=runSoftmaxCli('overflow',query);await tick();finish(children.at(-1),'[]');assert.equal((await next).exitCode,0);
});
test('timeout kills the read and never returns partial output as evidence',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const pending=runSoftmaxCli('timeout',query);await tick();const child=children.at(-1);child.stdout.write('{"partial":');
 t.mock.timers.tick(12000);const result=await pending;assert.equal(child.killed,true);assert.equal(result.timedOut,true);assert.equal(result.exitCode,124);assert.equal(result.stdout,'');
});
test('help cache does not cache failures or leak between accounts',async()=>{
 const help={program:'coworld',args:['episodes','--help']};
 let pending=runSoftmaxCli('help-a',help);await tick();finish(children.at(-1),'error',1);await pending;
 pending=runSoftmaxCli('help-a',help);await tick();finish(children.at(-1),'usage');await pending;
 const before=children.length;assert.equal((await runSoftmaxCli('help-a',help)).timing.reuse,'cache');assert.equal(children.length,before);
 pending=runSoftmaxCli('help-b',help);await tick();finish(children.at(-1),'usage');assert.equal((await pending).timing.reuse,'none');
});
