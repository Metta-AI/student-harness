import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s==='next/server')return next('next/server.js',c);try{return next(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(`${s}.ts`,c);throw e;}}});
const id='00000000-0000-4000-8000-000000000001';
let session=null;const reads=[];
mock.module('../lib/session.ts',{namedExports:{currentSession:async()=>session}});
mock.module('../lib/db.ts',{namedExports:{db:()=>({from(table){reads.push(table);const filters={};const result=()=>({error:null,data:table==='agent_tasks'?(filters.student_id==='alice'?{id,session_id:'wrun_current'}:null):table==='agent_task_executions'?[{session_id:'wrun_failed_before_usage'}]:table==='agent_task_usage'?[{call_key:'wrun_prior:turn:step'},{call_key:'wrun_child:turn:step'},{call_key:'wrun_child:turn:step2'},{call_key:'invalid:turn:step'}]:[]});const query={select(){return query;},eq(k,v){filters[k]=v;return query;},order(){return query;},abortSignal(){return query;},maybeSingle:async()=>result(),then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);}};return query;}})}});
const {GET}=await import('../app/api/tasks/[taskId]/route.ts');
const request=()=>GET(new Request(`http://localhost/api/tasks/${id}`),{params:Promise.resolve({taskId:id})});
test('session details gate all execution history by task ownership and recover prior/child runs',async()=>{
 assert.equal((await request()).status,401);assert.deepEqual(reads,[]);
 session={subjectId:'bob'};assert.equal((await request()).status,404);assert.deepEqual(reads,['agent_tasks']);
 session={subjectId:'alice'};const response=await request();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const body=await response.json();assert.deepEqual(body.sessionIds,['wrun_current','wrun_failed_before_usage','wrun_prior','wrun_child']);assert.deepEqual(body.history,[]);
});
