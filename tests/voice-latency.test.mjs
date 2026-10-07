import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({ resolve(s,c,n) { try { return n(s,c); } catch(e) { if(e.code==='ERR_MODULE_NOT_FOUND' && s.startsWith('.') && !/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c); throw e; } } });
const { ReadCache } = await import('../lib/voice/read-cache.ts');
const { LiveDelegation } = await import('../lib/voice/delegation.ts');
const { liveSessionConfig } = await import('../lib/voice/config.ts');
const deferred = () => { let resolve; const promise=new Promise(r=>resolve=r);return {promise,resolve}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function emit(loop,type,rest={}) { loop.accept({type:'response.event',delegation_id:'d',event:{type,...rest}}); }
function enqueue(loop,id,name) { emit(loop,'response.output_item.done',{item:{type:'function_call',call_id:id,name,arguments:'{}'}}); }

test('independent reads overlap, mutation is a barrier, continuation waits for every result',async()=>{
 const waits=new Map(['a','b','mutation','c'].map(id=>[id,deferred()]));const started=[],sent=[];
 const loop=new LiveDelegation(e=>sent.push(e),async call=>{started.push(call.call_id);await waits.get(call.call_id).promise;return {result:{ok:true}};},()=>{});
 emit(loop,'response.created',{response:{id:'r'}});
 enqueue(loop,'a','softmax_cli');enqueue(loop,'b','read_workspace');enqueue(loop,'mutation','start_research');enqueue(loop,'c','research_status');
 emit(loop,'response.completed',{response:{id:'r'}});await tick();assert.deepEqual(started,['a','b']);
 waits.get('b').resolve();await tick();assert.deepEqual(started,['a','b']);assert.equal(sent.length,0);
 waits.get('a').resolve();await tick();assert.deepEqual(started,['a','b','mutation']);assert.equal(sent.filter(e=>e.type==='response.create').length,0);
 waits.get('mutation').resolve();await tick();assert.deepEqual(started,['a','b','mutation','c']);
 waits.get('c').resolve();await loop.drained();assert.deepEqual(sent.filter(e=>e.item).map(e=>e.item.call_id),['a','b','mutation','c']);assert.equal(sent.filter(e=>e.type==='response.create').length,1);
});
test('overlap is bounded to four reads and duplicate call IDs execute once',async()=>{
 const wait=deferred();let running=0,peak=0,count=0;
 const loop=new LiveDelegation(()=>{},async()=>{count++;peak=Math.max(peak,++running);await wait.promise;running--;return {result:{ok:true}};},()=>{});
 emit(loop,'response.created',{response:{id:'r'}});
 for(let i=0;i<6;i++)enqueue(loop,String(i),'softmax_cli');enqueue(loop,'0','softmax_cli');emit(loop,'response.completed',{response:{id:'r'}});
 await tick();assert.equal(count,4);wait.resolve();await loop.drained();assert.equal(count,6);assert.equal(peak,4);
});
test('coalesced live reads are fresh after completion, isolated by key, and failures are retryable',async()=>{
 const cache=new ReadCache();const wait=deferred();let calls=0;const load=async()=>{calls++;await wait.promise;return calls;};
 const a=cache.run('account-a',load),b=cache.run('account-a',load),c=cache.run('account-b',load);await tick();assert.equal(calls,2);wait.resolve();
 const values=await Promise.all([a,b,c]);assert.deepEqual(values.map(v=>v.reuse),['none','inflight','none']);
 await cache.run('account-a',load);assert.equal(calls,3);
 await assert.rejects(cache.run('broken',async()=>{throw Error('offline');}));assert.equal((await cache.run('broken',async()=>7)).value,7);
});
test('only eligible successful results use bounded expiring help cache',async()=>{
 const cache=new ReadCache(1);let calls=0;const load=async()=>++calls;
 await cache.run('help',load,{ttlMs:1000});assert.equal((await cache.run('help',load)).reuse,'cache');
 await cache.run('other',load,{ttlMs:1000});assert.equal((await cache.run('help',load)).reuse,'none');
 const original=Date.now;Date.now=()=>original()+2000;
 try{assert.equal((await cache.run('other',load)).reuse,'none');}finally{Date.now=original;}
 await cache.run('fail',load,{ttlMs:1000,cacheable:()=>false});assert.equal((await cache.run('fail',load)).reuse,'none');
});
test('voice keeps the strongest configured backend with low dispatch reasoning and parallel tool selection',()=>{
 const config=liveSessionConfig();assert.equal(config.delegation.responses.model,process.env.OPENAI_VOICE_BACKEND_MODEL||'gpt-6-astra');assert.equal(config.delegation.responses.reasoning.effort,'low');assert.equal(config.delegation.responses.parallel_tool_calls,true);
});
