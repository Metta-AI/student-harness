import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
const {sha}=await import('../lib/campaigns/model.ts');
let campaign,row,studyState,diagnostic,compilation,requested,observed,downloads,saved;
const release={fingerprint:'release'},baseline={sourceHash:'base',versionId:'baseline-version'},candidate={source:'candidate',sourceHash:sha('candidate'),summary:'Diagnostic only',components:[{id:'trace',before:'original',after:'print original'}]},replay=Buffer.from('tape');
mock.module('../lib/db.ts',{namedExports:{db:()=>({from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{state:studyState}})})})}});
mock.module('../lib/campaigns/store.ts',{namedExports:{campaignById:async(id,owner)=>owner==='owner'?campaign:null,readArtifact:async(owner)=>owner==='owner'?row:null,checked:r=>r.data,artifact:async(...args)=>{saved.push(args);return 'artifact';}}});
mock.module('../lib/campaigns/candidate.ts',{namedExports:{verifiedCandidate:async()=>candidate}});
mock.module('../lib/campaigns/provider.ts',{namedExports:{episodeArtifact:async()=>{downloads++;return replay;}}});
mock.module('../lib/campaigns/evidence.ts',{namedExports:{markObserved:async(...args)=>observed.push(args)}});
mock.module('../lib/campaigns/worker.ts',{namedExports:{readReplayAudit:async()=>diagnostic,validatePolicySource:async()=>compilation,requestReplayAudit:async input=>{requested.push(input);return {status:'queued',jobId:'job'};}}});
const {probeCandidate,probeReplayInput}=await import('../lib/campaigns/probe.ts');
function setup(){
 campaign={id:'campaign',league_id:'league',state:'active',phase:'candidate',checkpoint:{builderId:'builder',baselines:[baseline],release}};
 row={kind:'episode-audit',league_id:'league',provenance:{studyId:'old-study'},content:{result:{seed:123},outcome:{episodeId:'ereq_one',audit:'verified',evidence:{native:{release:'release',replayHash:sha(replay),simulation:{hash_mismatches:0,ticks:3},vm:{source_hash:'base',subject:0,validated_hashes:3}}}}}};
 studyState='completed';diagnostic=null;compilation={valid:true};requested=[];observed=[];downloads=0;saved=[];
}
const run=()=>probeCandidate('owner','token','campaign','builder',{},'evidence');
test('exact baseline evidence queues an isolated diagnostic and excludes its replay from future confirmation',async()=>{
 setup();const r=await run();assert.equal(r.diagnostic.status,'queued');assert.equal(requested[0].mode,'candidate-prefix-probe');assert.equal(requested[0].source,'candidate');assert.equal(downloads,1);
 assert.deepEqual(observed[0],['owner','league','ereq_one','Candidate prefix diagnostic',123]);assert.equal(saved[0][2],'candidate-probe');assert(!('audit' in saved[0][4]));
 const content=saved[0][4];assert.equal(sha(content.source),content.candidateHash);assert.equal(content.baselineVersionId,'baseline-version');
 assert.deepEqual(content.proposal,{summary:candidate.summary,components:candidate.components});
 assert.equal(r.sourceAvailable,true);assert.equal(r.source,undefined);assert.equal(r.proposal,undefined);assert.deepEqual(r.componentIds,['trace']);
});
test('active, foreign, stale and incomplete evidence cannot be probed',async()=>{
 const mutations=[()=>campaign.state='paused',()=>campaign.phase='screen',()=>campaign.checkpoint.builderId='other',()=>row.league_id='foreign',()=>studyState='running',()=>studyState='invalid',()=>row.kind='candidate-probe',()=>row.content.outcome.evidence.native.vm.source_hash='other',()=>row.content.outcome.evidence.native.release='other',()=>row.content.outcome.evidence.native.vm.validated_hashes=2];
 for(const mutate of mutations){setup();mutate();await assert.rejects(run);assert.equal(requested.length,0);assert.equal(downloads,0);}
 setup();await assert.rejects(()=>probeCandidate('foreign','token','campaign','builder',{},'evidence'));
});
test('compile rejection starts no native probe; polling does not re-download or recompile',async()=>{
 setup();compilation={valid:false,error:'global limit'};assert.equal((await run()).status,'compile_rejected');assert.equal(requested.length,0);assert.equal(downloads,0);
 setup();diagnostic={status:'running',jobId:'job'};assert.equal((await run()).diagnostic.status,'running');assert.equal(downloads,0);assert.equal(requested.length,0);
 diagnostic={status:'completed',result:{kind:'candidate-prefix-probe',sourceHash:candidate.sourceHash,release:'release',replayHash:sha(replay),probe:{subject:0}}};
 assert.equal((await run()).diagnostic.status,'completed');diagnostic.result.kind='audit';await assert.rejects(run,/identity mismatch/);
});
test('standalone replay evidence must include exact baseline subject VM verification',()=>{
 setup();const native=row.content.outcome.evidence.native;
 const standalone={kind:'replay-evidence',content:{episodeId:'ereq_one',audit:{status:'completed',result:native}}};
 assert.equal(probeReplayInput(standalone,baseline,release).slot,0);delete native.vm;assert.throws(()=>probeReplayInput(standalone,baseline,release));
});
