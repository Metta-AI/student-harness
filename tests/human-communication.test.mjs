import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(`${s}.ts`,c);throw e;}}});
const {readableText,resultPreview,humanSummaryOf,studyHumanSummary}=await import('../lib/tasks/communication.ts');
const {candidateProposalSchema}=await import('../lib/campaigns/candidate-schema.ts');
const {campaignCompanion}=await import('../lib/partner/companion-summary.ts');
const id='3aedd773-c69d-4d33-b12f-5d49acbd0b2f',hash='a'.repeat(64);

test('legacy reports explain the blocked test without displaying identities or changing saved evidence',()=>{
 const summary=`Cycle 11 — blocked before candidate validation. Preserve champion ${id}, source ${hash}, on release ${'b'.repeat(64)}. The result is inconclusive; no policy was deployed.`;
 const result={summary,evidence:[id,hash]};const original=JSON.stringify(result);
 const text=resultPreview(result);
 assert.match(text,/proposed policy could not be tested yet/);assert.match(text,/Preserve our current best policy/);
 assert.match(text,/inconclusive; no policy was deployed/);assert(!text.includes(id));assert(!text.includes(hash));
 assert.equal(JSON.stringify(result),original);
});
test('human reports take precedence while exact handoffs and evidence remain intact',()=>{
 const humanSummary={outcome:'The retreat change has not been tested.',whyItMatters:'We do not know whether it improves our results.',nextStep:'Retry the failed test before changing our league policy.'};
 const result={summary:`Candidate ${id}`,humanSummary,evidence:[id]};
 assert.deepEqual(humanSummaryOf(result),humanSummary);
 assert.equal(resultPreview(result),`${humanSummary.outcome} ${humanSummary.whyItMatters}`);
 const campaign={id:'campaign',task_id:'root',state:'active',phase:'research',objective:'Improve our policy',cycle:10};
 const preview=campaignCompanion(campaign,[{id:'session',context:{campaignId:'campaign'},status:'completed',updated_at:'2026-10-07',result}]);
 assert.equal(preview.sourceId,'session');assert.match(preview.finding,/retreat change/);assert(!preview.finding.includes(id));
 assert.equal(result.evidence[0],id);assert.equal(result.summary,`Candidate ${id}`);
});
test('legacy reports preserve useful metrics, negation and exact evidence link destinations',()=>{
 const link=`See [replay ${id}](https://example.com/episodes/${id}) for evidence.`;
 assert.equal(readableText(link),`See [replay a saved reference](https://example.com/episodes/${id}) for evidence.`);
 const url=`https://example.com/episodes/${id}`;
 assert.equal(readableText(`See ${url}`),`See [Evidence](${url})`);
 const text='Won 7 of 40 games, down from 9. This does not show improvement.';
 assert.equal(readableText(text),text);
 assert.equal(resultPreview({summary:text,humanSummary:{outcome:''}}),text);
});
test('matched-study reports distinguish screening, confirmation and failure from deployment',()=>{
 const positive={pairs:40,baselineWins:9,candidateWins:12,passed:true};
 assert.match(studyHumanSummary(positive,'screen').whyItMatters,/independent testing/);
 assert.match(studyHumanSummary(positive,'confirmation').whyItMatters,/does not mean.*live/);
 const failed=studyHumanSummary({...positive,passed:false},'confirmation');
 assert.match(failed.whyItMatters,/do not justify replacing/);
 assert.match(failed.outcome,/40 matched games per policy/);
});
test('new candidate contract retains human reports and exact components; old saved outputs still parse',()=>{
 const old={summary:`Source ${hash}`,components:[{id:'retreat',before:'A',after:'B',condition:'Low health',action:'Retreat',expected:'Survive',falsifier:'More losses',evidence:[id]}]};
 assert.deepEqual(candidateProposalSchema.parse(old),old);
 const output={...old,humanSummary:{outcome:'A retreat change is ready to test.',whyItMatters:'It may avoid unnecessary deaths.',nextStep:'Compare it against our current policy.'}};
 assert.deepEqual(candidateProposalSchema.parse(output),output);
 assert.equal(candidateProposalSchema.required({humanSummary:true}).safeParse(old).success,false);
});

test('operational job counts are not promoted as campaign findings',()=>{
 const campaign={id:'campaign',task_id:'root',objective:'Improve team coordination',state:'running',phase:'research',cycle:2};
 const task={id:'count',context:{campaignId:'campaign'},status:'completed',updated_at:'2026-10-07',result:{summary:'1000/1000 native jobs completed'}};
 assert.equal(campaignCompanion(campaign,[task]).finding,null);
 assert.equal(campaignCompanion(campaign,[task,{...task,id:'finding',updated_at:'2026-10-06',result:{summary:'The candidate won more screening matches; confirmation is still needed.'}}]).sourceId,'finding');
});
