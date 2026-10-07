import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) { try { return next(specifier, context); } catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context); throw error; } } });
const { LiveDelegation } = await import('../lib/voice/delegation.ts');
const { createVoiceLease, verifyVoiceLease } = await import('../lib/voice/server.ts');
const { liveSessionConfig } = await import('../lib/voice/config.ts');
function emit(loop, type, rest={}) { loop.accept({ type:'response.event', delegation_id:'d1', event:{ type,...rest } }); }
function call(loop,id='call-1') { emit(loop,'response.output_item.done',{item:{type:'function_call',call_id:id,name:'start_research',arguments:'{"direction":"Inspect retreats"}'}}); }
test('Live stays independent while delegated tools run; empty completion output does not lose calls', async()=>{
 const sent=[];let resolve,calls=0;const pending=new Promise(r=>resolve=r);const working=[];
 const loop=new LiveDelegation(e=>sent.push(e),async()=>{calls++;await pending;return {result:{queued:true}};},v=>working.push(v));
 emit(loop,'response.created',{response:{id:'r1'}});call(loop);call(loop);
 emit(loop,'response.completed',{response:{id:'r1',output:[]}});await Promise.resolve();await Promise.resolve();
 assert.equal(sent.length,0);assert.equal(calls,1);assert.equal(working[0],true);
 resolve();await loop.drained();assert.deepEqual(sent.map(e=>e.type),['response.item.create','response.create']);
 assert.equal(JSON.parse(sent[0].item.output).queued,true);assert.equal(working.at(-1),false);
 emit(loop,'response.completed',{response:{id:'r1',output:[]}});await loop.drained();assert.equal(calls,1);
});
test('tool failure returns a result and continues; images are separate backend image inputs',async()=>{
 const sent=[];const loop=new LiveDelegation(e=>sent.push(e),async c=>{if(c.call_id==='bad')throw Error('secret upstream error');return {result:{ok:true},image:'aW1hZ2U='};},()=>{});
 emit(loop,'response.created',{response:{id:'r1'}});call(loop,'bad');call(loop,'image');emit(loop,'response.completed',{response:{id:'r1',output:[]}});await loop.drained();
 assert.equal(JSON.parse(sent[0].item.output).ok,false);assert(!JSON.stringify(sent).includes('secret'));
 assert.equal(sent[2].item.content[1].type,'input_image');assert.equal(sent.at(-1).type,'response.create');
});
test('closing voice does not cancel submitted work or send late continuations',async()=>{
 const sent=[];let resolve;const pending=new Promise(r=>resolve=r);
 const loop=new LiveDelegation(e=>sent.push(e),async()=>{await pending;return {result:{queued:true}};},()=>{});
 emit(loop,'response.created',{response:{id:'r1'}});call(loop);emit(loop,'response.completed',{response:{id:'r1'}});await Promise.resolve();loop.close();resolve();await loop.drained();assert.equal(sent.length,0);
});
test('voice lease is bound to account and expiry, and rejects tampering',()=>{
 process.env.SESSION_SECRET='a'.repeat(64);const lease=createVoiceLease('alice','session-1');assert.equal(verifyVoiceLease(lease,'alice').session,'session-1');assert.throws(()=>verifyVoiceLease(lease,'bob'));assert.throws(()=>verifyVoiceLease(lease.slice(0,-4)+'xxxx','alice'));
 const original=Date.now;Date.now=()=>original()+61*60_000;try{assert.throws(()=>verifyVoiceLease(lease,'alice'));}finally{Date.now=original;}
});
test('Live uses requested model with Responses delegation and server-side tool schemas',()=>{
 const config=liveSessionConfig();assert.equal(config.model,'gpt-live-1');assert.equal(config.delegation.type,'responses');assert.equal(config.delegation.responses.model,'gpt-6-astra');assert.equal(config.store,false);assert(config.delegation.responses.tools.some(t=>t.name==='start_research'));assert(config.delegation.responses.tools.some(t=>t.name==='workspace_screen'));
});
