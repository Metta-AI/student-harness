import {test,mock} from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
const {sha}=await import('../lib/campaigns/model.ts');
let campaign,study,deployed,champion,submissions,events,dropReply,uploads;
function db(){return {from(table){let filters=[],patch,insert;const q={eq(k,v){filters.push(r=>r[k]===v);return q;},select(){return q;},update(p){patch=p;return q;},insert(p){insert=p;return q;},single(){return q.maybeSingle();},maybeSingle(){return Promise.resolve({data:rows()[0]??null,error:null});},then(resolve,reject){return Promise.resolve({data:rows(),error:null}).then(resolve,reject);}};function rows(){let list=table==='research_campaigns'?[campaign]:deployed;if(insert){const id=`d${list.length}`;list.push({id,...structuredClone(insert),state:'prepared'});filters.push(r=>r.id===id);insert=null;}const matches=list.filter(r=>filters.every(f=>f(r)));if(patch)matches.forEach(r=>Object.assign(r,structuredClone(patch)));return structuredClone(matches);}return q;}};}
mock.module('../lib/db.ts',{namedExports:{db}});
mock.module('../lib/campaigns/store.ts',{namedExports:{checked:r=>{if(r.error)throw Error(r.error.message);return r.data;},recordEvent:async(c,key,kind,payload)=>events.push({key,kind,payload})}});
mock.module('../lib/campaigns/provider.ts',{namedExports:{
 currentRelease:async()=>({fingerprint:'release'}),champions:async(t,l,ids)=>ids.map(playerId=>({playerId,versionId:champion[playerId]})),
 uploadPolicy:async(t,owner,source,title,name,player)=>{assert.equal(sha(source),study.protocol.candidate.sourceHash);uploads++;return {id:`new-${player}`};},
 apiJSON:async(t,path,body)=>{if(body){const row={player:{id:body.player_id},policy_version:{id:body.policy_version_id},status:'completed'};submissions.push(row);champion[body.player_id]=body.policy_version_id;if(dropReply){dropReply=false;throw Error('Lost response after activation');}return row;}if(path.startsWith('/stats'))return {player_file_content_hash:study.protocol.candidate.sourceHash};return {entries:submissions};}
}});
const {promoteStudy}=await import('../lib/campaigns/promotion.ts');
function setup(){const source='10 END';campaign={id:'campaign',student_id:'owner',league_id:'league',state:'active',lease_token:'lease',lease_until:'2100-01-01',cycle:0,protocol:{promote:true},checkpoint:{baselines:[{playerId:'a',versionId:'old-a'},{playerId:'b',versionId:'old-b'}]}};study={id:'study',cohort:'confirmation',state:'completed',protocol_hash:'frozen',result:{passed:true,baselineWins:10,candidateWins:12,interval:[-.02,.05]},protocol:{candidate:{source,sourceHash:sha(source),summary:'candidate'},release:{fingerprint:'release'}}};deployed=[];champion={a:'old-a',b:'old-b'};submissions=[];events=[];dropReply=false;uploads=0;}
test('partial multi-player promotion resumes after lost activation receipt without duplicate submission',async()=>{
 setup();dropReply=true;await assert.rejects(()=>promoteStudy(campaign,study,'token'),/Lost response/);assert.equal(champion.a,'new-a');assert.equal(champion.b,'old-b');
 assert.equal((await promoteStudy(campaign,study,'token')).status,'verifying');assert.equal((await promoteStudy(campaign,study,'token')).status,'verified');
 assert.equal(submissions.length,2);assert.equal(uploads,2);assert(deployed.every(d=>d.state==='verified'));assert.deepEqual(deployed.map(d=>d.receipt.rollback.policy_version_id),['old-a','old-b']);
});
test('failed confirmation, changed incumbent and changed source prevent deployment',async()=>{
 setup();study.result.passed=false;await assert.rejects(()=>promoteStudy(campaign,study,'token'),/gate/);
 setup();champion.a='human-change';await assert.rejects(()=>promoteStudy(campaign,study,'token'),/conflict/);assert.equal(submissions.length,0);assert.equal(uploads,0);
 setup();study.protocol.candidate.source='different';await assert.rejects(()=>promoteStudy(campaign,study,'token'),/hash mismatch/);assert.equal(uploads,0);
});
