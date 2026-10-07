import assert from 'node:assert/strict';
import {test,mock,beforeEach} from 'node:test';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){if(s==='next/server')return n('next/server.js',c);try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
const policy='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',episodeId='ereq_33333333-3333-4333-8333-333333333333';
let signedIn=true,sameSite=true,episode,calls=[];
beforeEach(()=>{signedIn=true;sameSite=true;calls=[];episode={id:episodeId,round_id:'round',episode_id:'ep-resolved',status:'completed',coworld_id:'game',replay_url:'https://replays.example/game',policy_version_ids:[policy]};});
mock.module('next/server.js',{namedExports:{NextResponse:Response}});
mock.module('../lib/session.ts',{namedExports:{currentSession:async()=>signedIn?{subjectId:'alice',token:'alice-token'}:null,sameOrigin:()=>sameSite}});
// No local upload record: the regression is the active policy submitted outside the IDE.
mock.module('../lib/db.ts',{namedExports:{policyVersionBySoftmaxId:async()=>null}});
mock.module('../lib/softmax.ts',{namedExports:{
 listLeagueSubmissions:async token=>token==='alice-token'?[{policy_version:{id:policy}}]:[],
 getEpisodeRequest:async()=>episode,getEpisodeResults:async()=>[{id:episodeId,participants:[{position:5,policy_version_id:policy},{position:6,policy_version_id:other}]}],
 createReplaySession:async(...args)=>{calls.push(['viewer',...args]);return {viewer_url:'https://viewer.example',ready:true};},
 replaySessionReady:async()=>({ready:true}),getEpisodeStats:async()=>({steps:500,game_stats:{},policy_stats:[]}),
 getExperience:async()=>({requester_user_id:'bob',episodes:[]}),
 createCoachingSession:async(token,input)=>{calls.push(['coaching',input]);return {id:'csn-created'};},listCoachingSessions:async()=>[],SoftmaxError:class extends Error{},
}});
const replay=await import('../app/api/replay-session/route.ts'),stats=await import('../app/api/episode-stats/route.ts'),coaching=await import('../app/api/coaching/route.ts');
const post=(api,body)=>api.POST(new Request('http://localhost/api',{method:'POST',body:JSON.stringify(body)}));
const coach=(overrides={})=>({policyVersionId:policy,episodeId,slot:5,idempotencyKey:other,context:'Retreat before the tower engages.',...overrides});
test('league replay and statistics accept externally submitted owned policy',async()=>{
 const response=await post(replay,{policyVersionId:policy,episodeId});assert.equal(response.status,200);assert.equal((await response.json()).episode_id,'ep-resolved');
 assert.equal((await stats.GET(new Request(`http://localhost/api?policyVersionId=${policy}&episodeId=${episodeId}`))).status,200);
});
test('replay rejects another user policy and nonparticipating owned policy',async()=>{
 assert.equal((await post(replay,{policyVersionId:other,episodeId})).status,403);
 episode.policy_version_ids=[other];assert.equal((await post(replay,{policyVersionId:policy,episodeId})).status,403);assert.equal(calls.length,0);
});
test('league coaching derives immutable episode, replay, policy and seat server-side',async()=>{
 assert.equal((await post(coaching,coach({replay_uri:'https://attacker.example',episode_id:'fake'}))).status,200);
 assert.deepEqual(calls[0][1],{idempotency_key:other,episode_id:'ep-resolved',coworld_id:'game',replay_uri:'https://replays.example/game',declared_context:'Retreat before the tower engages.',policy_version_id:policy,slot:5});
});
test('coaching rejects forged ownership, opponent seat, missing reference and unfinished replay',async()=>{
 assert.equal((await post(coaching,coach({policyVersionId:other}))).status,403);
 assert.equal((await post(coaching,coach({slot:6}))).status,409);
 assert.equal((await post(coaching,coach({policyVersionId:undefined}))).status,400);
 episode.status='running';assert.equal((await post(coaching,coach())).status,404);assert.equal(calls.length,0);
});
test('coaching defaults to a verified owned seat, and preserves practice ownership check',async()=>{
 assert.equal((await post(coaching,coach({slot:undefined}))).status,200);assert.equal(calls[0][1].slot,5);
 assert.equal((await post(coaching,coach({runId:'xreq_44444444-4444-4444-8444-444444444444'}))).status,403);
});
test('unauthenticated and cross-origin replay/coaching writes are rejected',async()=>{
 signedIn=false;assert.equal((await post(replay,{policyVersionId:policy,episodeId})).status,401);assert.equal((await post(coaching,coach())).status,401);
 signedIn=true;sameSite=false;assert.equal((await post(coaching,coach())).status,403);assert.equal((await post(replay,{policyVersionId:policy,episodeId})).status,403);assert.equal(calls.length,0);
});
