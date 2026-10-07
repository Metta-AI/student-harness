import assert from 'node:assert/strict';
import {test} from 'node:test';
import {leaguePolicyEntries,selectPerformancePolicy} from '../lib/league-policy-selection.ts';
import {listLeagueMemberships,listLeagueSubmissions} from '../lib/softmax.ts';
const membership=(id,player,overrides={})=>({status:'competing',substatus:'active',is_champion:true,start_time:'2026-10-06T05:00:00Z',end_time:null,division:{id:'division'},policy_version:{id,label:`${id}:v1`},player:{id:player,name:player},...overrides});
test('active champions supersede local/placed benched policies and stay scoped to owned players and division',()=>{
 const submissions=[{status:'placed',policy_version:{id:'old',label:'hunter:v1'},player:{id:'ours'}},{status:'placed',policy_version:{id:'current',label:'crossbow:v1'},player:{id:'ours'}}];
 const memberships=[membership('old','ours',{substatus:'benched',is_champion:false,start_time:'2026-10-07'}),membership('current','ours'),membership('rival','other'),membership('wrong-division','ours',{division:{id:'other'}}),membership('ended','ours',{end_time:'2026-10-06'}),membership('disqualified','ours',{status:'disqualified'})];
 const result=leaguePolicyEntries(submissions,memberships,'division');
 assert.deepEqual(result.entered,['current']);assert.equal(result.currentPolicyId,'current');
 assert.equal(result.entries.find(e=>e.policyVersionId==='old').active,false);
 assert.equal(result.entries.find(e=>e.policyVersionId==='old').status,'benched');
 assert.equal(result.entries.find(e=>e.policyVersionId==='current').policyLabel,'crossbow:v1');
 assert(!result.entries.some(e=>e.policyVersionId==='rival'));
 assert.equal(selectPerformancePolicy('',result.currentPolicyId,true,'old'),'current');
 assert.equal(selectPerformancePolicy('old',result.currentPolicyId,true,'old'),'old','Explicit historical selection remains available');
 assert.equal(selectPerformancePolicy('',undefined,false,'old'),'','Wait for membership instead of briefly showing the old policy');
});
test('multiple owned players choose newest active champion without losing the other entry',()=>{
 const submissions=['one','two'].map(id=>({status:'placed',policy_version:{id},player:{id}}));
 const result=leaguePolicyEntries(submissions,[membership('one','one',{start_time:'2026-10-05'}),membership('two','two')],'division');
 assert.equal(result.currentPolicyId,'two');assert.deepEqual(result.entered,['two','one']);
});
test('Softmax readers preserve live policy labels and membership state across pages',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async url=>{
  const u=new URL(url);if(u.pathname.endsWith('league-submissions'))return Response.json([{id:'sub',status:'placed',policy_version:{id:'current',label:'crossbow:v1'},player:{id:'ours',name:'a-aron'}}]);
  assert.equal(u.searchParams.get('league_id'),'league-test');calls++;
  return Response.json({entries:[membership(calls===1?'old':'current','ours')],next_cursor:calls===1?'page-2':null});
 };
 try{const rows=await listLeagueMemberships('test-token',undefined,'league-test');assert.equal(rows.length,2);assert.equal(rows[1].policy_version.label,'current:v1');const submissions=await listLeagueSubmissions('test-token');assert.equal(submissions[0].policy_version.label,'crossbow:v1');}finally{globalThis.fetch=original;}
});
