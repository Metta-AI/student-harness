import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
let c,compilation,saves,artifacts,children,uploads,profiles=[],reused=null;
class InvalidCandidate extends Error{}
mock.module('../lib/campaigns/fixtures.ts',{namedExports:{extendFixtures:()=>{throw Error('No fixtures before compiler passes');},freshSeedFixtures:()=>{throw Error('No fixtures before compiler passes');}}});
mock.module('../lib/campaigns/candidate.ts',{namedExports:{InvalidCandidate,verifiedCandidate:async()=>({source:'candidate',sourceHash:'hash',summary:'proposal'})}});
mock.module('../lib/db.ts',{namedExports:{studentToken:async()=> 'private',db:()=>({from(){return {select(){return this;},eq(){return this;},limit:async()=>({data:[],error:null})};}})}});
mock.module('../lib/tasks/store.ts',{namedExports:{rpc:async()=>{},taskById:async()=>({id:'builder',status:'completed',result:{components:['patch']}}),createTask:async(owner,input)=>{children.push(input);return {id:'repair'};}}});
mock.module('../lib/opponents/store.ts',{namedExports:{opponentRoster:async()=>({profiles})}});
mock.module('../lib/campaigns/research-reuse.ts',{namedExports:{reusableOpponentResearch:async()=>reused}});
mock.module('../lib/campaigns/store.ts',{namedExports:{artifact:async(...args)=>{artifacts.push(args);return 'artifact';},checked:r=>r.data,claimCampaign:async()=>c,saveCampaign:async(_c,patch)=>{saves.push(patch);return {...c,...patch};},recordEvent:async()=>{}}});
mock.module('../lib/campaigns/provider.ts',{namedExports:{fixtureInputs:async()=>{},leagueFixtureMetadata:async()=>[{id:'same-round'}],resolveBaselines:async()=>{},episodeArtifact:async()=>{},uploadPolicy:async()=>{uploads++;}}});
mock.module('../lib/campaigns/worker.ts',{namedExports:{auditWorkerReady:async()=>true,validatePolicySource:async()=>{if(compilation instanceof Error)throw compilation;return compilation;}}});
mock.module('../lib/campaigns/studies.ts',{namedExports:{processStudy:async()=>{}}});
mock.module('../lib/campaigns/promotion.ts',{namedExports:{promoteStudy:async()=>{},reconcileStoppedDeployments:async()=>{}}});
const {processCampaign}=await import('../lib/campaigns/orchestrator.ts');
function setup(){c={id:'campaign',student_id:'owner',league_id:'league',state:'active',phase:'candidate',cycle:2,checkpoint:{baselines:[{}],release:{},builderId:'builder'}};saves=[];artifacts=[];children=[];uploads=0;}
test('native compiler rejection creates a repair session before fixture selection or uploads',async()=>{
 setup();compilation={valid:false,error:'global count exceeds limit'};await processCampaign(c.id);
 assert.equal(uploads,0);assert.equal(children.length,1);assert.match(children[0].objective,/global count exceeds limit/);
 assert.equal(saves.at(-1).checkpoint.builderId,'repair');assert.equal(saves.at(-1).checkpoint.candidateRepairs,1);
 assert.deepEqual(artifacts.map(a=>a[2]),['policy-compilation','candidate-rejection']);
});
test('compiler infrastructure failure retries the candidate without consuming a repair or uploading',async()=>{
 setup();compilation=Error('Compiler unavailable');await processCampaign(c.id);
 assert.equal(uploads,0);assert.equal(children.length,0);assert.equal(artifacts.length,0);
 assert.equal(saves.at(-1).phase,undefined);assert.match(saves.at(-1).checkpoint.message,/Compiler unavailable/);
});
test('only a successful compiler receipt advances candidate to fresh fixture selection',async()=>{
 setup();compilation={valid:true};await processCampaign(c.id);
 assert.equal(uploads,0);assert.equal(children.length,0);assert.equal(saves.at(-1).phase,'select-fixtures');
 assert.deepEqual(artifacts.map(a=>a[2]),['policy-compilation','candidate']);
});
test('fresh-seed campaigns learn from a completed study without waiting for another league round',async()=>{
 setup();c.phase='observe';c.protocol={continuous:true,fixtureMode:'fresh-seeds',observeMinutes:60};
 c.checkpoint={observationHead:'same-round',lastResult:{details:{studyId:'finished-study'}},direction:'Improve wins'};
 await processCampaign(c.id);assert.equal(saves.at(-1).phase,'baseline');assert.equal(saves.at(-1).cycle,3);
 assert.equal(saves.at(-1).checkpoint.lastResult.details.studyId,'finished-study');assert.equal(saves.at(-1).checkpoint.direction,'Improve wins');
 saves=[];c.protocol.fixtureMode='league';await processCampaign(c.id);assert.equal(saves.at(-1).phase,undefined);assert.match(saves.at(-1).checkpoint.message,/Waiting for new league/);
 saves=[];c.protocol.fixtureMode='fresh-seeds';delete c.checkpoint.lastResult;await processCampaign(c.id);assert.equal(saves.at(-1).phase,undefined);
 saves=[];c.protocol.continuous=false;await processCampaign(c.id);assert.equal(saves.at(-1).state,'completed');
});

test('research reuse preserves fresh own-replay and previous-result sessions',async()=>{
 setup();c.phase='research';c.checkpoint={baselines:[{versionId:'champion',sourceHash:'base'}],release:{fingerprint:'release'}};
 profiles=[{policyId:'opponent',policyLabel:'Opponent:v1',current:true,own:false}];reused={id:'prior-opponent',status:'completed'};
 await processCampaign(c.id);
 assert.equal(children.length,1);assert.equal(children[0].context.role,'replay');
 assert.equal(children[0].context.baselineHash,'base');assert.equal(children[0].context.releaseFingerprint,'release');
 assert.deepEqual(saves.at(-1).checkpoint.researchTasks,['prior-opponent','repair']);
 assert.deepEqual(saves.at(-1).checkpoint.reusedResearchTasks,['prior-opponent']);
 c.checkpoint={...saves.at(-1).checkpoint,lastResult:{details:{studyId:'previous'}}};children=[];
 await processCampaign(c.id);assert.equal(children.length,1);assert.equal(children[0].context.role,'result-review');
 assert.deepEqual(saves.at(-1).checkpoint.researchTasks,['prior-opponent','repair','repair']);
 profiles=[];reused=null;
});
