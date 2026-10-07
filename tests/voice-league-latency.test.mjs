import assert from 'node:assert/strict';import {test,mock} from 'node:test';import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
let release;const slowMetadata=new Promise(r=>release=r);let boardStarted=false,recordCalls=0;
mock.module('../lib/softmax.ts',{namedExports:{
 getLeague:async()=>{await slowMetadata;return {id:'league',name:'GoTA'};},
 getCompetitionDivision:async()=>({id:'division'}),
 getPolicyLeaderboard:async(_token,id,signal)=>{assert.equal(id,'division');assert(signal instanceof AbortSignal);boardStarted=true;return [{rank:1,policy_version_id:'ours',policy_label:'Our policy',player_id:'player',score:0,episodes_played:3}];},
 getLeagueStandings:async()=>[{rank:36,player_id:'player',player_name:'Alice',score:7.38,score_label:'MMR',rounds_played:3,policy_label:'Our policy'}],
 listLeagueSubmissions:async()=>[],
}});
mock.module('../lib/db.ts', { namedExports: { db: () => ({
 from(table) {
  assert.equal(table, 'policy_versions');
  const query = {
   select(columns) { assert.equal(columns, 'softmax_policy_version_id'); return query; },
   eq(column, id) { assert.equal(column, 'student_id'); assert.equal(id, 'alice'); return query; },
   abortSignal(signal) { assert(signal instanceof AbortSignal); return Promise.resolve({data: [{softmax_policy_version_id: 'ours'}], error: null}); },
  };
  return query;
 },
}) } });
mock.module('../lib/league-record.ts',{namedExports:{leagueRecord:async()=>{recordCalls++;return {};}}});
const {readLiveLeague}=await import('../lib/voice/league.ts');
test('leaderboard starts as soon as division resolves, without waiting for metadata; default skips expensive record',async()=>{
 const result=readLiveLeague('alice','token');await new Promise(r=>setImmediate(r));assert.equal(boardStarted,true);release();const data=await result;assert.equal(data.ourPolicies[0].rank,36);assert.equal(recordCalls,0);assert.equal(data.record,null);
});
