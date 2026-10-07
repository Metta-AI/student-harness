import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
const citation='00000000-0000-4000-8000-000000000001';
let unavailable=false;
mock.module('../lib/db.ts',{namedExports:{db:()=>({from(){const filters={};return {select(){return this;},eq(k,v){filters[k]=v;return this;},async in(_k,ids){return {data:filters.student_id==='owner'&&filters.league_id==='league'&&ids.includes(citation)?[{id:citation}]:[],error:unavailable?{message:'offline'}:null};}};}})}});
const {verifiedCandidate,InvalidCandidate,fixtureSeat}=await import('../lib/campaigns/candidate.ts');
const base={source:'if ordinal <= 1 then\nreturn\nend if',sourceHash:'base'};
const proposal={summary:'Late defense',components:[{id:'defend',before:'ordinal <= 1',after:'(ordinal <= 1 or worldTick >= 15000)',condition:'Late base threat',action:'Defend',expected:'Fewer losses',falsifier:'More losses',evidence:[citation]}]};
test('candidate accepts owned replay/claim artifacts, not just session summaries',async()=>{
 const c=await verifiedCandidate('owner','league',base,proposal);assert.match(c.source,/worldTick >= 15000/);
 for(const [owner,league] of [['other','league'],['owner','other']])await assert.rejects(verifiedCandidate(owner,league,base,proposal),InvalidCandidate);
 await assert.rejects(verifiedCandidate('owner','league',base,{...proposal,components:[{...proposal.components[0],evidence:['truncated-id']}]}),/full artifact UUIDs/);
});
test('candidate structural failures are repairable, provider failures remain retryable',async()=>{
 await assert.rejects(verifiedCandidate('owner','league',base,{...proposal,components:[{...proposal.components[0],before:'missing span'}]}),InvalidCandidate);
 unavailable=true;try{await assert.rejects(verifiedCandidate('owner','league',base,proposal),e=>!(e instanceof InvalidCandidate)&&/offline/.test(e.message));}finally{unavailable=false;}
});
test('matched fixture placement covers every team ordinal and balances red/blue',()=>{
 assert.deepEqual(Array.from({length:10},(_,i)=>fixtureSeat(i)),[0,5,1,6,2,7,3,8,4,9]);
 for(const count of [16,64,128]){const seats=Array.from({length:count},(_,i)=>fixtureSeat(i));assert.equal(seats.filter(s=>s<5).length,count/2);assert.equal(new Set(seats).size,10);}
});
