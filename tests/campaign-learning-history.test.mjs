import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
let records,requestedLimit;
mock.module('../lib/db.ts',{namedExports:{db:()=>({from(table){
 assert.equal(table,'research_studies');const filters=[];const q={
  select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},lt(k,v){filters.push(r=>r[k]<v);return q;},
  in(k,vs){filters.push(r=>vs.includes(r[k]));return q;},order(){return q;},
  async limit(n){requestedLimit=n;return {data:records.filter(r=>filters.every(f=>f(r))).slice(0,n),error:null};}
 };return q;
}})}});
mock.module('../lib/campaigns/store.ts',{namedExports:{checked:r=>r.data}});
const {campaignLearningHistory}=await import('../lib/campaigns/learning-history.ts');
test('learning history preserves older decisions without leaking active or foreign evidence',async()=>{
 const c={id:'campaign',student_id:'owner',cycle:3,checkpoint:{baselines:[{sourceHash:'base'}],release:{fingerprint:'release'}}};
 const row={id:'first',task_id:'session',student_id:'owner',campaign_id:'campaign',cycle:0,cohort:'screen',state:'completed',result:{passed:false,baselineWins:8,candidateWins:7},baselineHash:'base',candidateHash:'candidate',release:'release',summary:'x'.repeat(800),components:[{id:'portal',before:'private full source'}]};
 records=[row,{...row,id:'invalid',cycle:1,state:'invalid',result:{invalidReason:'Compiler rejected',baselineWins:6}},
  {...row,id:'other-release',cycle:2,release:'old',baselineHash:'old'},
  ...[{state:'running'},{state:'auditing'},{state:'canceled'},{cycle:3},{student_id:'foreign'},{campaign_id:'other'}].map(p=>({...row,...p}))];
 const history=await campaignLearningHistory(c);
 assert.equal(requestedLimit,20);assert.equal(history.length,3);
 assert.equal(history[0].summary.length,600);assert.equal(history[0].sessionUrl,'/sessions/session');
 assert.deepEqual(history[0].componentIds,['portal']);assert.equal(history[0].components,undefined);
 assert.equal(history[0].sameBaseline,true);assert.equal(history[0].sameRelease,true);
 assert.deepEqual(history[1].result,{invalidReason:'Compiler rejected'});
 assert.equal(history[2].sameRelease,false);assert.equal(history[2].sameBaseline,false);
 records=Array.from({length:30},(_,i)=>({...row,id:String(i)}));
 assert.equal((await campaignLearningHistory(c)).length,20);
});
