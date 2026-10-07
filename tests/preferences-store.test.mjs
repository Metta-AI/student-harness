import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({ resolve(s,c,n) { try { return n(s,c); } catch(e) { if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s)) return n(`${s}.ts`,c); throw e; } } });
let writes, scope;
const row = { preferred_name: '', voice_name: 'marin', response_length: 'balanced', reasoning_effort: 'high', live_captions: true };
mock.module('../lib/db.ts',{namedExports:{db:()=>({from(table){assert.equal(table,'students');const query={select(){return query;},update(values){writes=values;return query;},eq(column,id){scope={column,id};return query;},async single(){return {data:{...row,...writes},error:null};}};return query;}})}});
const {userPreferences,saveUserPreferences}=await import('../lib/preferences-store.ts');
test('preference store targets account and writes only specified columns',async()=>{
 assert.equal((await userPreferences('alice')).reasoningEffort,'high');
 assert.deepEqual(scope,{column:'subject_id',id:'alice'});
 const saved=await saveUserPreferences('bob',{voice:'willow',liveCaptions:false});
 assert.deepEqual(scope,{column:'subject_id',id:'bob'});
 assert.deepEqual(writes,{voice_name:'willow',live_captions:false});
 assert.equal(saved.reasoningEffort,'high');assert.equal(saved.voice,'willow');assert.equal(saved.liveCaptions,false);
});
