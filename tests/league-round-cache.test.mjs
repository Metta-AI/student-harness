import assert from 'node:assert/strict';
import {test} from 'node:test';
import {leagueRoundNumbers} from '../lib/softmax.ts';
test('concurrent round checks share scanning and foreign rounds do not repeatedly scan league history',async()=>{
 const original=globalThis.fetch,now=Date.now;let calls=0;
 globalThis.fetch=async url=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));return Response.json(new URL(url).searchParams.has('cursor')?{entries:[{id:'ours-old',round_number:1}],next_cursor:null}:{entries:[{id:'ours-new',round_number:2}],next_cursor:'older'});};
 try {
  const [a,b]=await Promise.all([leagueRoundNumbers('test-token',['ours-new','foreign']),leagueRoundNumbers('test-token',['ours-old','foreign-other'])]);
  assert.deepEqual([...a],[['ours-new',2]]);assert.deepEqual([...b],[['ours-old',1]]);assert.equal(calls,2);
  assert.deepEqual([...await leagueRoundNumbers('test-token',['foreign-third'])],[]);assert.equal(calls,2);
  Date.now=()=>now()+31000;
  await leagueRoundNumbers('test-token',['new-round']);assert.equal(calls,4,'Negative cache expires so new rounds can be discovered');
 }finally{globalThis.fetch=original;Date.now=now;}
});
