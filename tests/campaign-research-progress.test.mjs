import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectResearchOpponents,researchProgress} from '../lib/campaigns/research-progress.ts';
test('research selects distinct rival players and prioritizes current versions',()=>{
 const p=(playerId,version,rank,current)=>({playerId,policyId:`${playerId}-${version}`,policyLabel:`${playerId}:v${version}`,rank,current,own:false});
 const selected=selectResearchOpponents([p('relh',386,1,false),p('relh',395,1,true),p('bot',58,2),p('bot',9,2),p('third',1,3),{...p('ours',1,0,true),own:true}]);
 assert.deepEqual(selected.map(p=>p.policyId),['relh-395','bot-58','third-1']);
});
test('campaign progress reflects completed, working, queued and paused investigations',()=>{
 assert.equal(researchProgress(['completed','running','queued','paused'].map(status=>({status}))),'1/4 investigations complete · 1 working · 1 queued · 1 need attention');
});
