import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
let rows=[],writes=0,race=false,readError=false;
mock.module('../lib/db.ts',{namedExports:{db:()=>({from(table){assert.equal(table,'research_artifacts');let filters={},insert;const q={select(){return q;},eq(k,v){filters[k]=v;return q;},upsert(row){insert=row;return q;},maybeSingle:async()=>({data:rows.find(r=>Object.entries(filters).every(([k,v])=>r[k]===v))??null,error:readError?{message:'read unavailable'}:null}),single(){return q.maybeSingle();},then(resolve){writes++;const saved={...insert,id:`artifact-${rows.length}`};if(race){rows.push(saved);race=false;return Promise.resolve({data:[],error:null}).then(resolve);}rows.push(saved);return Promise.resolve({data:[{id:saved.id}],error:null}).then(resolve);}};return q;}})}});
mock.module('../lib/tasks/store.ts',{namedExports:{rpc:async()=>{throw Error('Unexpected RPC');}}});
const {artifact}=await import('../lib/campaigns/store.ts');
test('repeated replay evidence reuses immutable content without indexing another insert',async()=>{
 rows=[];writes=0;const body={events:Array(500).fill({damage:10})};
 const first=await artifact('owner','league','replay-evidence','Original',body);
 assert.equal(await artifact('owner','league','replay-evidence','Retried title',body),first);
 assert.equal(writes,1);assert.equal(rows[0].title,'Original');
 assert.notEqual(await artifact('other-owner','league','replay-evidence','Other',body),first);
 assert.notEqual(await artifact('owner','other-league','replay-evidence','Other',body),first);
 assert.notEqual(await artifact('owner','league','episode-audit','Other',body),first);
});
test('concurrent insertion resolves the conflict winner and failed reads do not write',async()=>{
 rows=[];writes=0;race=true;assert.equal(await artifact('owner','league','replay-evidence','Race',{tick:1}),'artifact-0');
 readError=true;try{await assert.rejects(artifact('owner','league','replay-evidence','Error',{tick:2}),/read unavailable/);assert.equal(writes,1);}finally{readError=false;}
});
