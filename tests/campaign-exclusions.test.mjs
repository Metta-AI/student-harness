import {test,mock} from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
let attempt,filters,calls,results,spec;
mock.module('../lib/db.ts',{namedExports:{db:()=>({from(table){assert.equal(table,'research_attempts');filters={};return {select(){return this;},eq(k,v){filters[k]=v;return this;},async maybeSingle(){return {data:attempt};}};}})}});
mock.module('../lib/campaigns/store.ts',{namedExports:{checked:r=>{if(r.error)throw Error(r.error.message);return r.data;}}});
mock.module('../lib/campaigns/provider.ts',{namedExports:{episodeArtifact:async(token,id,kind)=>{calls.push(kind);const result=kind==='results'?results:spec;if(result instanceof Error)throw result;return result;}}});
const {observedSeed}=await import('../lib/campaigns/exclusions.ts');
function reset(){attempt=null;calls=[];results={seed:12};spec={game_config:{seed:13}};}
test('failed private attempts resolve their frozen seed without requiring a results artifact',async()=>{
 reset();attempt={research_fixtures:{fixture:{seed:0}}};assert.equal(await observedSeed('owner','league','token','episode'),0);assert.deepEqual(calls,[]);
 assert.deepEqual(filters,{'episode_id':'episode','research_fixtures.student_id':'owner','research_fixtures.league_id':'league'});
});
test('external observations use results or missing-result spec, retaining failures instead of forgetting seeds',async()=>{
 reset();assert.equal(await observedSeed('owner','league','token','episode'),12);
 reset();results=Error('Softmax 404: missing results');assert.equal(await observedSeed('owner','league','token','episode'),13);assert.deepEqual(calls,['results','spec']);
 reset();results=Error('Softmax 503: unavailable');await assert.rejects(observedSeed('owner','league','token','episode'),/503/);assert.deepEqual(calls,['results']);
 reset();results=Error('Softmax 404: missing results');spec={};await assert.rejects(observedSeed('owner','league','token','episode'),/seed is unavailable/);
});
