import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
const {opponentToolSchema}=await import('../lib/opponents/model.ts');
const policy='00000000-0000-4000-8000-000000000001';
const observations=[];
mock.module('../lib/campaigns/evidence.ts',{namedExports:{markObserved:async(student,league,id)=>{observations.push({student,league,id});}}});
const rows={opponent_snapshots:[],opponent_notes:[],opponent_models:[],chat_sessions:[],agent_tasks:[]};let unavailable=false;
mock.module('../lib/db.ts',{namedExports:{db:()=>({from:table=>{const filters=[];const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q;},is:(k,v)=>{filters.push([k,v]);return q;},in:(k,v)=>{filters.push([k,v]);return q;},order:()=>q,limit:()=>q,then:resolve=>resolve({data:rows[table].filter(r=>filters.every(([k,v])=>Array.isArray(v)?v.includes(r[k]):r[k]===v)),error:null}),insert:async row=>{rows[table].push({id:"00000000-0000-4000-8000-000000000010",...row});return {error:null};}};return q;}})}});
mock.module('../lib/league-overview.ts',{namedExports:{readLeagueOverview:async(_t,leagueId)=>({league:{url:`https://softmax.com/league/${leagueId}`},division:{id:'division'},standings:[{player_id:'rival',rank:4,score:12,score_label:'MMR'}],ownPlayers:['me'],rounds:[{id:'ours',round_number:9}],checkedAt:'2026-10-06T00:00:00Z'})}});
mock.module('../lib/softmax.ts',{namedExports:{getEpisodeRequest:async(_t,id)=>({id,round_id:id==='ereq_other'?'different':'ours',policy_version_ids:id==='ereq_foreign'?['foreign']:[policy],created_at:'today',status:'completed',replay_url:'url'}),getPolicyLeaderboard:async()=>[{policy_version_id:policy,policy_label:'rival:v2',player_id:'rival',player_name:'Rival',rank:1,score:99,episodes_played:4}],listPolicyVersionEpisodeRequests:async()=>{if(unavailable)throw Error('Upstream 500');return ({next_cursor:'more',entries:[{id:'yes',round_id:'ours',status:'completed',created_at:'today',replay_url:'url'},{id:'no',round_id:'different-league'},{id:'practice',round_id:null}]});},getEpisodeResults:async(_t,ids)=>{if(!ids.length)return [];assert(ids.every(id=>observations.some(e=>e.id===id)), 'Episode must be excluded from future studies before reading scores');assert(ids.every(id=>['yes','ereq_known'].includes(id)));return [{id:ids[0],participants:[{position:0,policy_version_id:policy},{position:1,policy_version_id:'other'}],participant_scores:[{position:0,score:0},{position:1,score:99}]}];}}});
const {opponentRoster,opponentResearch,readOpponent}=await import('../lib/opponents/store.ts');
test('opponent collection keeps official player ranking, exact policy scores and league-scoped evidence',async()=>{
 const roster=await opponentRoster('alice','token','league-a');assert.equal(roster.profiles[0].rank,4);assert.equal(roster.profiles[0].rating,12);
 const snapshot=await opponentResearch('alice','token',{action:'collect',policyId:policy},'preston','league-a');
 assert.equal(snapshot.episodes.length,1);assert.deepEqual(snapshot.episodes[0].scores,[{position:0,score:0}]);assert.equal(snapshot.hasMore,true);
 assert.equal((await readOpponent('bob',policy,'league-a')).snapshots.length,0);
 assert.equal((await readOpponent('alice',policy,'league-b')).snapshots.length,0);
 assert.equal((await readOpponent('alice',policy,'league-a')).snapshots.length,1);
 await opponentResearch('alice','token',{action:'note',policyId:policy,note:{kind:'hypothesis',text:'Earlier grouping may help.',evidence:[{label:'Round 9',url:'https://softmax.com/observatory/v2'}]}},'preston','league-a');
 assert.equal(rows.opponent_notes[0].actor,'preston');assert.equal(rows.opponent_notes[0].kind,'hypothesis');
 await assert.rejects(()=>opponentResearch('bob','token',{action:'note',policyId:policy,note:{kind:'observation',text:'Recorded score is zero.',evidence:[{label:'Round 9',url:'https://softmax.com/observatory/v2'}]}},'human','league-a'),/Collect/);
});
test('opponent tool keeps an object schema and requires policy IDs and evidence',()=>{
 assert.equal(opponentToolSchema.safeParse({action:'list'}).success,true);
 for(const action of ['read','collect','note'])assert.equal(opponentToolSchema.safeParse({action}).success,false);
 assert.equal(opponentToolSchema.safeParse({action:'note',policyId:policy,note:{kind:'observation',text:'Observed behavior.',evidence:[]}}).success,false);
 assert.equal(opponentToolSchema.safeParse({action:'note',policyId:policy,note:{kind:'observation',text:'Observed behavior.',evidence:[{label:'Fake',url:'javascript:alert(1)'}]}}).success,false);
});

test('an unavailable episode API saves standings with an explicit incomplete-evidence warning',async()=>{
 unavailable=true;
 try{const result=await opponentResearch('alice','token',{action:'collect',policyId:policy},'human','league-a');assert.equal(result.profile.rank,4);assert.equal(result.episodes.length,0);assert.match(result.warning,/could not provide/);}finally{unavailable=false;}
});

test('semantic model saves evidence only from the same account, league and policy',async()=>{
 const input={action:'save_model',policyId:policy,model:{schema:'gota-opponent-semantic-ir/1',summary:'We only know the recorded standing.',evidence:[{id:'standing',snapshotId:rows.opponent_snapshots[0].id,detail:'Collected league standings.'}],nodes:[],edges:[],unknowns:['No observed strategy.'],nextTests:['Inspect one replay before inferring behavior.']}};
 await opponentResearch('alice','token',input,'preston','league-a');
 assert.equal((await readOpponent('alice',policy,'league-a')).models.length,1);
 assert.deepEqual((await opponentRoster('alice','token','league-a')).research,[{policyId:policy,hasNotes:true,hasModel:true}]);
 assert.deepEqual((await opponentRoster('bob','token','league-a')).research,[]);
 for(const [student,league] of [['bob','league-a'],['alice','league-b']])await assert.rejects(()=>opponentResearch(student,'token',input,'preston',league),/Model evidence/);
 await assert.rejects(()=>opponentResearch('alice','token',{...input,policyId:'00000000-0000-4000-8000-000000000099'},'preston','league-a'),/Model evidence/);
 input.model.evidence[0].episodeId='foreign-episode';
 await assert.rejects(()=>opponentResearch('alice','token',input,'preston','league-a'),/Model evidence/);
 input.model.evidence[0].episodeId='yes';
 assert.deepEqual(await opponentResearch('alice','token',input,'preston','league-a'),{saved:true});
});

test('CLI-discovered episodes can be attached, with policy and league checks',async()=>{
 const input={action:'collect',policyId:policy,episodeIds:['ereq_known']};
 const saved=await opponentResearch('alice','token',input,'preston','league-a');
 assert.equal(saved.episodes[0].id,'ereq_known');assert.match(saved.coverage,/Selected episode/);
 for(const id of ['ereq_other','ereq_foreign'])await assert.rejects(()=>opponentResearch('alice','token',{...input,episodeIds:[id]},'preston','league-a'),/outside/);
});

test('mixed episode batches preserve valid evidence and return an immediately citable snapshot',async()=>{
 const saved=await opponentResearch('alice','token',{action:'collect',policyId:policy,episodeIds:['ereq_known','ereq_other','ereq_foreign']},'preston','league-a');
 assert.deepEqual(saved.episodes.map(e=>e.id),['ereq_known']);
 assert.deepEqual(saved.rejectedEpisodes.map(e=>e.id),['ereq_other','ereq_foreign']);
 assert.match(saved.warning,/Excluded 2/);
 const snapshot=rows.opponent_snapshots.find(s=>s.id===saved.snapshotId);
 assert.equal(snapshot.policy_id,policy);
 assert.deepEqual(snapshot.document.episodes,saved.episodes);
});
