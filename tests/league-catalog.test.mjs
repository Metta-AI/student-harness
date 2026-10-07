import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
import {activeCatalog,defaultLeagueId,workspaceURL} from '../lib/league-catalog.ts';
const other='league_ad6dc809-4696-46f5-99a5-fc2b1c58d082';
const {readLeagueOverview}=await import('../lib/league-overview.ts');
const {liveSessionConfig}=await import('../lib/voice/config.ts');
const {createVoiceLease,verifyVoiceLease}=await import('../lib/voice/server.ts');
test('catalog defaults to requested GoTA league and separates leagues sharing a game',()=>{
 const game={id:'game',name:'GoTA'};
 const rows=activeCatalog([{id:other,name:'Community',game},{id:defaultLeagueId,name:'Main',game},{id:'archived',name:'NeuralHub',game,disabled_at:'2026-01-01'},{id:'private',game,hidden:true}]);
 assert.deepEqual(rows.map(r=>r.id),[defaultLeagueId,other]);assert.equal(workspaceURL(defaultLeagueId),'/');assert.equal(workspaceURL(other),`/?league=${other}`);
});
test('league overview scopes divisions, entries and rounds to selected league; preserves its score metric',async()=>{
 const original=globalThis.fetch;const requests=[];
 globalThis.fetch=async url=>{const u=new URL(url);requests.push(u);const p=u.pathname;
  if(p.endsWith('/leagues/'+other))return Response.json({id:other,name:'Other league',game:{id:'game-other',name:'Other game'}});
  if(p.endsWith('/divisions')){assert.equal(u.searchParams.get('league_id'),other);return Response.json([{id:'div-other',name:'Competition',type:'competition'}]);}
  if(p.endsWith('/league-submissions')){assert.equal(u.searchParams.get('league_id'),other);assert.equal(u.searchParams.get('mine'),'true');return Response.json({entries:[{id:'submission',status:'placed',player:{id:'mine',name:'Me'}}],next_cursor:null});}
  if(p.endsWith('/div-other/leaderboard'))return Response.json([{rank:1,player_id:'mine',player_name:'Me',score:0.25,score_label:'Survival',score_value_type:'percent',rounds_played:8}]);
  if(p.endsWith('/rounds')){assert.equal(u.searchParams.get('league_id'),other);assert.equal(u.searchParams.get('division_id'),'div-other');return Response.json({entries:[],next_cursor:null});}
  throw Error('Unexpected endpoint '+p);
 };
 try{const d=await readLeagueOverview('token',other);assert.equal(d.league.id,other);assert.equal(d.standings[0].score_label,'Survival');assert.equal(d.standings[0].score_value_type,'percent');assert.deepEqual(d.ownPlayers,['mine']);assert(!requests.some(u=>u.toString().includes(defaultLeagueId)));await assert.rejects(()=>readLeagueOverview('token',other,'div-wrong'),/does not belong/);}
 finally{globalThis.fetch=original;}
});
test('other-game voice leases and tools cannot silently dispatch default GoTA policy work',()=>{
 process.env.SESSION_SECRET='a'.repeat(64);
 const lease=createVoiceLease('alice','live-other',other);assert.equal(verifyVoiceLease(lease,'alice').leagueId,other);assert.throws(()=>verifyVoiceLease(lease,'bob'));
 const config=liveSessionConfig(undefined,{id:other,name:'Other league',gameName:'Other game'});
 const names=config.delegation.responses.tools.map(t=>t.name);
 assert(names.includes('live_league'));assert(names.includes('create_view'));assert(names.includes('softmax_cli'));
 for(const name of ['start_research','read_workspace','research_status','pause_research'])assert(!names.includes(name));
 assert(config.instructions.includes(other));assert(config.delegation.responses.instructions.includes(other));
 assert(liveSessionConfig().delegation.responses.tools.some(t=>t.name==='start_research'));
});
