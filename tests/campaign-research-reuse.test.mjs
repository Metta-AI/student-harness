import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
let records=[],queries=0;
mock.module('../lib/db.ts',{namedExports:{db:()=>({from(table){
 assert.equal(table,'agent_tasks');queries++;const filters=[];
 const value=(r,k)=>k.startsWith('context->>')?r.context[k.slice(10)]:r[k];
 const q={select(){return q;},eq(k,v){filters.push(r=>value(r,k)===v);return q;},
 gte(k,v){filters.push(r=>value(r,k)>=v);return q;},lte(k,v){filters.push(r=>value(r,k)<=v);return q;},order(){return q;},
 async limit(n){return {data:records.filter(r=>filters.every(f=>f(r))).slice(0,n),error:null};}};return q;
}})}});
mock.module('../lib/campaigns/store.ts',{namedExports:{checked:r=>r.data}});
const {reusableOpponentResearch}=await import('../lib/campaigns/research-reuse.ts');
const {taskInputSchema}=await import('../lib/tasks/model.ts');
const now=Date.parse('2026-10-07T12:00:00Z');
const c={id:'campaign',student_id:'owner',league_id:'league',checkpoint:{baselines:[{sourceHash:'base'}],release:{fingerprint:'release'}}};
const row={id:'session',student_id:'owner',kind:'research',status:'completed',created_at:new Date(now-60000).toISOString(),
 context:{campaignId:'campaign',leagueId:'league',role:'opponent',policyId:'policy',baselineHash:'base',releaseFingerprint:'release'},result:{status:'completed',summary:'Saved version-scoped observations and counterexamples.'}};
test('completed exact-scope opponent research is reused with original session provenance',async()=>{
 records=[row];assert.equal((await reusableOpponentResearch(c,'policy',now)).id,'session');
});
test('foreign, changed, stale, incomplete and unscoped research is never reused',async()=>{
 const patches=[{student_id:'foreign'},{kind:'experiment'},{status:'failed'},{status:'running'},
  {created_at:new Date(now-86400001).toISOString()},{created_at:new Date(now+60000).toISOString()},
  {result:null},{result:{}},{result:{status:'needs_input',summary:'Need evidence'}},{result:{status:'completed',summary:' '}},
  ...Object.keys(row.context).map(k=>({context:{...row.context,[k]:'other'}})),{context:{...row.context,baselineHash:undefined}}];
 for(const patch of patches){records=[{...row,...patch}];assert.equal(await reusableOpponentResearch(c,'policy',now),null,JSON.stringify(patch));}
 records=[{...row,result:null},row];assert.equal((await reusableOpponentResearch(c,'policy',now)).id,'session');
 const count=queries;assert.equal(await reusableOpponentResearch({...c,checkpoint:{}},'policy',now),null);assert.equal(queries,count);
});
test('task input retains validated baseline and release provenance',()=>{
 const input={objective:'Model the selected opponent',acceptanceCriteria:'Save observed evidence and counterexamples',requestKey:'request-123',context:{baselineHash:'a'.repeat(64),releaseFingerprint:'b'.repeat(64)}};
 assert.deepEqual(taskInputSchema.parse(input).context,input.context);
 assert.equal(taskInputSchema.safeParse({...input,context:{baselineHash:'invalid'}}).success,false);
});
