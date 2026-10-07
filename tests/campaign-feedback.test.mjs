import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
let study,attempts,reads,saved;
mock.module('../lib/db.ts',{namedExports:{db:()=>({from(table){const filters={};return {select(columns){if(table==='research_attempts')assert.equal(columns,'fixture_id,arm,attempt,result:outcome_summary,evidenceId:receipt->>evidenceId');return this;},eq(k,v){filters[k]=v;return this;},async maybeSingle(){return {data:Object.entries(filters).every(([k,v])=>study[k]===v)?study:null,error:null};},order(){return this;},async range(start,end){reads++;return {data:attempts.slice(start,end+1).map(a=>({...a,result:a.result?Object.fromEntries(Object.entries(a.result).filter(([key])=>key!=='evidence')):null})),error:null};}};}})}});
mock.module('../lib/campaigns/store.ts',{namedExports:{checked:r=>{if(r.error)throw Error(r.error.message);return r.data;},artifact:async(...args)=>{saved=args;return 'feedback-id';}}});
const {previousStudyFeedback}=await import('../lib/campaigns/feedback.ts');
const campaign={id:'campaign',student_id:'owner',league_id:'league',cycle:1,checkpoint:{lastResult:{details:{studyId:'study'}}}};
function reset(){
 reads=0;saved=null;
 study={id:'study',student_id:'owner',campaign_id:'campaign',state:'completed',cycle:0,cohort:'screen',task_id:'task',result:{passed:false},protocol:{pairs:1,baseline:{sourceHash:'base'},candidate:{sourceHash:'candidate',components:[{id:'late-defense'}]}}};
 attempts=['baseline','candidate'].map((arm,i)=>({fixture_id:'fixture',arm,attempt:0,result:{audit:'verified',episodeId:arm,utility:i?0.5:1,evidence:{large:'not embedded'}},evidenceId:`${arm}-evidence`}));
}
test('failed study feeds exact paired counterexamples and immutable components into the next cycle',async()=>{
 reset();const feedback=await previousStudyFeedback(campaign);
 assert.equal(feedback.artifactId,'feedback-id');assert.equal(feedback.pairs[0].utilityDelta,-0.5);
 assert.equal(feedback.pairs[0].baseline.evidenceId,'baseline-evidence');assert.equal(feedback.pairs[0].candidate.episodeId,'candidate');
 assert.equal(feedback.pairs[0].baseline.evidence,undefined);assert.deepEqual(feedback.components,[{id:'late-defense'}]);
 assert.equal(saved[1],'league');assert.equal(saved[2],'study-feedback');
});
test('feedback never reads held-out, foreign, current-cycle or incomplete comparisons',async()=>{
 for(const patch of [{state:'running'},{state:'canceled'},{student_id:'other'},{campaign_id:'other'},{cycle:1}]){
  reset();Object.assign(study,patch);assert.equal(await previousStudyFeedback(campaign),null);assert.equal(reads,0);assert.equal(saved,null);
 }
 reset();attempts.pop();await assert.rejects(previousStudyFeedback(campaign),/missing audited pairs/);assert.equal(saved,null);
 reset();attempts[0].result.audit='unverified';await assert.rejects(previousStudyFeedback(campaign),/missing audited pairs/);
});
test('invalid studies retain exact candidate identity without exposing partial outcome comparisons',async()=>{
 reset();study.state='invalid';study.result={invalidReason:'Compiler global limit'};
 const feedback=await previousStudyFeedback(campaign);
 assert.equal(reads,0);assert.equal(feedback.state,'invalid');assert.equal(feedback.candidateHash,'candidate');
 assert.deepEqual(feedback.components,[{id:'late-defense'}]);assert.deepEqual(feedback.pairs,[]);
 assert.equal(feedback.result.invalidReason,'Compiler global limit');assert.match(feedback.guidance,/not a negative gameplay result/);
});

test('large completed confirmations retain every pair across summary pages',async()=>{
 reset();study.protocol.pairs=512;
 const template=attempts;
 attempts=Array.from({length:512},(_,i)=>template.map(a=>({...a,fixture_id:`fixture-${i}`}))).flat();
 const feedback=await previousStudyFeedback(campaign);
 assert.equal(reads,3);assert.equal(feedback.pairs.length,512);
 assert.equal(feedback.pairs.at(-1).fixtureId,'fixture-511');
 assert.ok(feedback.pairs.every(p=>p.utilityDelta===-0.5&&p.baseline.evidenceId==='baseline-evidence'));
});
