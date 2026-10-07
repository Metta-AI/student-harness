import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
let tables,requests,fail;
mock.module('../lib/db.ts',{namedExports:{db:()=>({from(table){
 const filters={};let cursor='',limit,order;
 const q={select(){return q;},eq(k,v){filters[k]=v;return q;},order(k){order=k;return q;},limit(n){limit=n;return q;},gt(k,v){assert.equal(k,'episode_id');cursor=v;return q;},
 then(resolve,reject){
  assert.equal(order,'episode_id');assert.ok(limit<=1000);
  requests.push({table,cursor});
  const data=tables[table].filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v)&&r.episode_id>cursor)
   .sort((a,b)=>a.episode_id.localeCompare(b.episode_id)).slice(0,limit).map(({episode_id,seed_key})=>({episode_id,seed_key}));
  return Promise.resolve(fail&&cursor?{error:{message:'history unavailable'}}:{data}).then(resolve,reject);
 }};return q;
}})}});
mock.module('../lib/campaigns/store.ts',{namedExports:{checked:r=>{if(r.error)throw Error(r.error.message);return r.data;}}});
const {fixtureHistory}=await import('../lib/campaigns/fixture-history.ts');
function reset(count){
 requests=[];fail=false;tables={};
 for(const table of ['research_fixtures','research_exclusions'])tables[table]=Array.from({length:count},(_,i)=>({student_id:'owner',league_id:'league',episode_id:`${table}_${String(i).padStart(5,'0')}`,seed_key:String(i)}));
}
test('reads full reserved and observed history past API row caps, isolated by owner and league',async()=>{
 reset(1251);
 tables.research_exclusions[1250].seed_key=null;
 tables.research_fixtures.push({student_id:'foreign',league_id:'league',episode_id:'foreign',seed_key:'x'},
  {student_id:'owner',league_id:'other',episode_id:'other',seed_key:'y'});
 const history=await fixtureHistory('owner','league');
 assert.equal(history.length,2502);assert.equal(new Set(history.map(r=>r.episode_id)).size,2502);
 assert.ok(history.some(r=>r.episode_id==='research_fixtures_01250'));
 assert.ok(history.some(r=>r.seed_key===null));assert.ok(!history.some(r=>['x','y'].includes(r.seed_key)));
 assert.equal(requests.length,6);
});
test('exact page boundaries and empty history terminate; partial read failures do not return incomplete exclusions',async()=>{
 reset(500);assert.equal((await fixtureHistory('owner','league')).length,1000);assert.equal(requests.length,4);
 reset(0);assert.deepEqual(await fixtureHistory('owner','league'),[]);assert.equal(requests.length,2);
 reset(1001);fail=true;await assert.rejects(fixtureHistory('owner','league'),/history unavailable/);
});
