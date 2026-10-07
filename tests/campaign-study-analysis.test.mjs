import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
let rows,study,campaign,pages,saved;
mock.module('../lib/db.ts',{namedExports:{db:()=>({from(table){const filters={};const q={select(){return q;},eq(k,v){filters[k]=v;return q;},order(){return q;},
 async maybeSingle(){return {data:study&&Object.entries(filters).every(([k,v])=>study[k]===v)?study:null,error:null};},
 async range(start,end){assert.equal(table,'research_attempts');assert.equal(filters.study_id,study.id);assert.equal(filters.state,'complete');assert.ok(end-start<8,'native evidence pages must stay small');pages.push(start);return {data:rows.slice(start,end+1),error:null};}};return q;}})}});
mock.module('../lib/campaigns/store.ts',{namedExports:{checked:r=>{if(r.error)throw Error(r.error.message);return r.data;},campaignById:async(id,owner)=>campaign?.id===id&&campaign.student_id===owner?campaign:null,artifact:async(...args)=>{saved=args;return 'analysis-artifact';}}});
const {hashObject}=await import('../lib/campaigns/model.ts');
const {analyzeStudy,completedStudyAnalysis}=await import('../lib/campaigns/study-analysis.ts');
function attempt(fixture,arm,utility=0.5,deaths=2){
 const ticks=200,slot=0;
 return {fixture_id:fixture,arm,episode_id:`ereq_${fixture}-${arm}`,evidenceId:`evidence-${fixture}-${arm}`,
 result:{audit:'verified',episodeId:`ereq_${fixture}-${arm}`,utility,evidence:{slot,native:{release:'release',vm:{subject:slot,source_hash:arm,validated_hashes:ticks},
 simulation:{ticks,winner:utility===0.5?-1:utility===1?0:1,hash_mismatches:0,subject:slot,
 heroes:[{slot,class_name:'Crossbowman',deaths,xp:100,hits:30,gold:80}],item_action_count:2,item_actions:[{kind:'buy_item'},{kind:'buyback'}]}}}}};
}
function reset(pairs=2){
 const protocol={pairs,baseline:{sourceHash:'baseline'},candidate:{sourceHash:'candidate'},release:{fingerprint:'release'}};
 study={id:'study',student_id:'owner',campaign_id:'campaign',state:'completed',cycle:0,cohort:'screen',result:{passed:false},protocol,protocol_hash:hashObject(protocol)};
 campaign={id:'campaign',student_id:'owner',league_id:'league'};pages=[];saved=null;
 rows=Array.from({length:pairs},(_,i)=>[attempt(`f${i}`,'baseline',0.5,2),attempt(`f${i}`,'candidate',i%2?0:1,4)]).flat();
}
test('all-pair arithmetic and source links survive outcome filtering and pagination',()=>{
 reset();let report=analyzeStudy(study,rows,{outcome:'improved',limit:1});
 assert.equal(report.all.pairs,2);assert.equal(report.all.improved,1);assert.equal(report.all.regressed,1);
 assert.deepEqual(report.all.metrics.deaths,{pairedCoverage:2,baselineMean:2,candidateMean:4,meanDelta:2});
 assert.equal(report.matchedPairs,1);assert.equal(report.pairs.length,1);assert.equal(report.nextOffset,null);
 assert.equal(report.pairs[0].baseline.evidenceId,'evidence-f0-baseline');assert.equal(report.decision,study.result);
 report=analyzeStudy(study,rows,{limit:1});assert.equal(report.nextOffset,1);
 assert.equal(analyzeStudy(study,rows,{offset:1,limit:1}).pairs[0].fixtureId,'f1');
 rows[3].result.evidence.native.simulation.heroes[0].class_name='Demon Hunter';
 assert.equal(analyzeStudy(study,rows).byHeroClass.length,2);
});
test('incomplete or wrong-subject command ledgers are unknown, never zero',()=>{
 reset();rows[1].result.evidence.native.simulation.item_action_count=3;
 let report=analyzeStudy(study,rows);assert.equal(report.all.metrics.buyCommands.pairedCoverage,1);
 assert.equal(report.pairs[0].candidate.metrics.buyCommands,null);
 rows[3].result.evidence.native.simulation.subject=5;
 report=analyzeStudy(study,rows);assert.equal(report.all.metrics.buyCommands.pairedCoverage,0);
 assert.equal(report.all.metrics.buyCommands.meanDelta,null);assert.equal(report.all.metrics.deaths.pairedCoverage,2);
 reset();delete rows[1].result.evidence.native.simulation.item_actions;
 assert.equal(analyzeStudy(study,rows).pairs[0].candidate.commandLedgerComplete,false);
});
test('partial, duplicate, corrupted and nonterminal comparisons are rejected',()=>{
 for(const state of ['running','auditing','invalid','canceled']){reset();study.state=state;assert.throws(()=>analyzeStudy(study,rows),/Only completed/);}
 reset();assert.throws(()=>analyzeStudy(study,rows.slice(1)),/missing audited pairs/);
 reset();assert.throws(()=>analyzeStudy(study,[...rows,rows[0]]),/Duplicate/);
 reset();rows[0].result.evidence.native.vm.source_hash='wrong';assert.throws(()=>analyzeStudy(study,rows),/verified subject/);
 reset();rows[0].result.evidence.native.vm.validated_hashes=199;assert.throws(()=>analyzeStudy(study,rows),/verified subject/);
 reset();rows[0].result.utility=1;assert.throws(()=>analyzeStudy(study,rows),/native outcome/);
 reset();study.protocol.pairs=3;assert.throws(()=>analyzeStudy(study,rows),/protocol hash/);
});
test('ownership and league checks run before attempt reads; all 1024 arms are loaded and report is saved',async()=>{
 reset();await assert.rejects(completedStudyAnalysis('foreign','league','study'),/completed owned/);assert.equal(pages.length,0);
 await assert.rejects(completedStudyAnalysis('owner','other-league','study'),/this league/);assert.equal(pages.length,0);
 study.state='running';await assert.rejects(completedStudyAnalysis('owner','league','study'),/completed owned/);assert.equal(saved,null);
 reset(512);const report=await completedStudyAnalysis('owner','league','study',{limit:5},'research-task');
 assert.equal(pages.length,129);assert.equal(pages.at(-1),1024);assert.equal(report.all.pairs,512);assert.equal(report.pairs.length,5);
 assert.equal(report.artifactId,'analysis-artifact');assert.equal(saved[2],'study-analysis');
 assert.deepEqual(report, {artifactId:'analysis-artifact',...analyzeStudy(study,rows,{limit:5})});
 assert.equal(saved[5].taskId,'research-task');assert.equal(saved[5].provenance.protocolHash,study.protocol_hash);
});
