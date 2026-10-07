import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
const {constructCandidate,sha,hashObject,summarize,gameRequest}=await import('../lib/campaigns/model.ts');
const base={source:'10 PRINT 1\n20 PRINT 2\n',sourceHash:sha('10 PRINT 1\n20 PRINT 2\n'),versionId:'base',playerId:'ours',playerName:'Ours'};
const component=(before,after)=>({id:before,before,after,condition:'fighting',action:'attack',expected:'win more',falsifier:'loses wins',evidence:['known']});
test('candidate components compose against a fixed baseline, with evidence and overlap checks',()=>{
 const p={summary:'Two components',components:[component('PRINT 1','PRINT 3'),component('PRINT 2','PRINT 4')]};
 assert.equal(constructCandidate(base,p,new Set(['known'])).source,'10 PRINT 3\n20 PRINT 4\n');
 assert.equal(base.source,'10 PRINT 1\n20 PRINT 2\n');
 assert.throws(()=>constructCandidate(base,p,new Set()),/unknown evidence/);
 assert.throws(()=>constructCandidate(base,{...p,components:[component('PRINT 1','PRINT 3'),component('1\n20','5\n20')]},new Set(['known'])),/overlap/);
});
test('matched arm retries hold all inputs constant except intended policy and operation key',()=>{
 const fixture={seed:123,slot:5,roster:Array.from({length:10},(_,i)=>`p${i}`),hashes:Array(10).fill('hash'),config:{seed:123,map:'x'},release:{coworldId:'cow_fixed'}};
 const b=gameRequest('s','f',fixture,'baseline','base');const c=gameRequest('s','f',fixture,'candidate','new');const retry=gameRequest('s','f',fixture,'candidate','new',1);
 assert.deepEqual(b.game_config_overrides,c.game_config_overrides);
 assert.deepEqual(b.roster.filter(r=>r.slot!==5),c.roster.filter(r=>r.slot!==5));
 assert.equal(c.roster[5].player.policy_ref,'new');assert.deepEqual(c.roster,retry.roster);assert.notEqual(c.idempotency_key,retry.idempotency_key);
 assert.equal(hashObject({a:1,b:2}),hashObject({b:2,a:1}));
});
const outcome=(utility,xp=100)=>({utility,xp,score:xp,win:utility===1,loss:utility===0});
test('positive XP cannot promote worse wins; unfinished comparisons cannot be judged',()=>{
 const regression=[{baseline:outcome(1),candidate:outcome(.5,1000)},{baseline:outcome(.5),candidate:outcome(.5,1500)}];
 const r=summarize(regression,2,'directional');assert.ok(r.xpDelta>0);assert.equal(r.passed,false);
 assert.throws(()=>summarize(regression,3,'directional'),/every frozen pair/);
});
test('directional and confidence gates remain distinct and bootstrap is reproducible',()=>{
 const pairs=Array.from({length:128},(_,i)=>({baseline:outcome(.5),candidate:outcome(i<10?1:i<16?0:.5)}));
 const r=summarize(pairs,128,'directional');assert.equal(r.passed,true);assert.ok(r.interval[0]<=0);
 assert.equal(summarize(pairs,128,'confidence').passed,false);assert.deepEqual(r,summarize(pairs,128,'directional'));
});
test('an entirely negative paired interval is reported as regression, not uncertainty around zero',()=>{
 const pairs=Array.from({length:40},(_,i)=>({baseline:outcome(.5),candidate:outcome(i<4?0:.5)}));
 const result=summarize(pairs,40,'directional');
 assert.ok(result.interval[1]<0);assert.equal(result.passed,false);
 assert.match(result.interpretation,/Negative.*regressed/);
});
