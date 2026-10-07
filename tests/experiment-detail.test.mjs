import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {registerHooks} from 'node:module';
import {experimentDetail} from '../lib/workspace/experiment-detail.ts';
registerHooks({resolve(s,c,next){if(s==='next/server')return next('next/server.js',c);try{return next(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(`${s}.ts`,c);throw e;}}});
const id='xreq_00000000-0000-0000-0000-000000000001';
const run={xp_request_id:id,student_id:'alice',policy_version_id:null,title:'Test',hypothesis:null,status:'completed',episodes:[{id:'done',status:'completed',our_scores:[0,10],participant_scores:[],replay_url:null},{id:'failed',status:'failed',our_scores:[100]}],summary:null,created_at:'2026-10-05T10:00:00Z',completed_at:null};
test('experiment metrics use only completed episodes and preserve zero scores, failures and missing hypotheses',()=>{
 const d=experimentDetail(run,null);
 assert.equal(d.meanScore,5);assert.deepEqual(d.counts,{total:2,completed:1,failed:1,scoredSeats:2});
 assert.equal(d.hypothesis,null);assert.equal(d.policy,null);assert(!('student_id' in d));
 assert.equal(experimentDetail({...run,episodes:[]},null).meanScore,null);
 assert.equal(experimentDetail({...run,episodes:[{...run.episodes[0],our_scores:[0]}]},null).meanScore,0);
});
let session={subjectId:'alice'};let lookup=[];
mock.module('../lib/session.ts',{namedExports:{currentSession:async()=>session}});
mock.module('../lib/db.ts',{namedExports:{experimentByXp:async(student,xp)=>{lookup.push([student,xp]);return student==='alice'&&xp===id?run:null;},listPolicyVersions:async()=>[],policyVersionByRevision:async()=>null}});
const {GET}=await import('../app/api/experiments/route.ts');
const request=()=>new Request(`http://localhost/api/experiments?id=${id}`);
test('details API authenticates and scopes every lookup to the signed-in account',async()=>{
 session=null;assert.equal((await GET(request())).status,401);assert.equal(lookup.length,0);
 session={subjectId:'bob'};assert.equal((await GET(request())).status,404);
 session={subjectId:'alice'};assert.equal((await GET(new Request('http://localhost/api/experiments?id=invalid'))).status,400);
 const response=await GET(request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal((await response.json()).meanScore,5);assert.deepEqual(lookup,[['bob',id],['alice',id]]);
});
