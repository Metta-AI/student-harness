import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {gameReference} from '../lib/campaigns/reference.ts';
const source=`https://github.com/Metta-AI/polyworld/tree/${'a'.repeat(40)}/examples/gods_of_the_arena`;
test('mechanics lookup pins source, caches reads and preserves line references',async()=>{
 let calls=0;
 const fetch=mock.method(globalThis,'fetch',async url=>{calls++;assert.equal(url,`https://raw.githubusercontent.com/Metta-AI/polyworld/${'a'.repeat(40)}/examples/gods_of_the_arena/replays.nim`);return new Response(Array.from({length:300},(_,i)=>i===20?'ActionUseItemAt = 15':`line ${i+1}`).join('\n'));});
 try{
  const r=await gameReference(source,'replays.nim','actionuseitemat',1,10);
  assert.deepEqual(r.matches,[21]);assert.equal(r.excerpt.find(l=>l.line===21).text,'ActionUseItemAt = 15');assert.equal(r.nextLine,26);
  assert.equal((await gameReference(source,'replays.nim','ActionUseItemAt',22)).excerpt.length,0);
  assert.equal((await gameReference(source,'replays.nim','',1,999)).excerpt.length,200);assert.equal(calls,1);
  for(const url of ['http://localhost/private',source.replace('/tree/','/blob/'),source.replace('a'.repeat(40),'main')])await assert.rejects(gameReference(url,'replays.nim'),/Unsupported/);
  await assert.rejects(gameReference(source,'../../secret'),/Unsupported/);assert.equal(calls,1);
 }finally{fetch.mock.restore();}
});
test('failed source fetch is retryable rather than a permanently cached failure',async()=>{
 let calls=0;const fetch=mock.method(globalThis,'fetch',async()=>++calls===1?new Response('',{status:503}):new Response('WorldScale = 60000'));
 try{await assert.rejects(gameReference(source,'sim.nim'),/503/);assert.equal((await gameReference(source,'sim.nim')).excerpt[0].text,'WorldScale = 60000');assert.equal(calls,2);}finally{fetch.mock.restore();}
});
