import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(`${s}.ts`,c);throw e;}}});
let student={subjectId:'alice',token:'test-token'},origin=true;const tasks=new Map();const lookups=[];
const id='00000000-0000-4000-8000-000000000001';let creates=0;
mock.module('../lib/session.ts',{namedExports:{currentSession:async()=>student,sameOrigin:()=>origin}});
mock.module('../lib/tasks/store.ts',{namedExports:{rpc:async()=>{},createTask:async(owner,input,session)=>{creates++;if(!tasks.has(input.requestKey))tasks.set(input.requestKey,{id,student_id:owner,status:'queued',objective:input.objective,max_cost_usd:input.maxCostUsd,context:input.context,checkpoint:{},result:null,origin_session_id:session});return tasks.get(input.requestKey);},listTasks:async()=>({tasks:[...tasks.values()],workers:[]}),taskById:async(taskId,owner)=>{lookups.push([taskId,owner]);return [...tasks.values()].find(t=>t.id===taskId&&t.student_id===owner)??null;}}});
const {POST}=await import('../app/api/voice/tool/route.ts');const {createVoiceLease}=await import('../lib/voice/server.ts');const {liveSessionConfig}=await import('../lib/voice/config.ts');
process.env.SESSION_SECRET='a'.repeat(64);
function request(name,args,lease=createVoiceLease('alice','live-test')){return new Request('http://localhost:3000/api/voice/tool',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify({lease,callId:'call-1',name,args})});}
test('voice queues a durable account-scoped session with replay context, stable retry key and no chat',async()=>{
 const input={objective:'Analyze the most recent replay for positioning mistakes.',acceptanceCriteria:'Save evidence-linked findings and concrete next tests.',title:'Replay analysis',episodeId:'episode-1'};
 const a=await POST(request('start_session',input)),b=await POST(request('start_session',input));assert.equal(a.status,200);assert.equal(b.status,200);
 const result=(await a.json()).result;assert.equal(result.taskId,id);assert.equal(result.status,'queued');assert.equal(result.url,`/sessions/${id}`);assert.equal(tasks.size,1);
 const task=tasks.get('voice:live-test:call-1');assert.equal(task.student_id,'alice');assert.equal(task.origin_session_id,'live-test');assert.equal(task.max_cost_usd,25);assert.equal(task.context.mode,'auto');assert.equal(task.context.episodeId,'episode-1');
 const config=liveSessionConfig();assert(config.delegation.responses.tools.some(t=>t.name==='start_session'));assert(config.delegation.responses.tools.some(t=>t.name==='session_status'));
});
test('voice task status checks ownership and rejects invalid leases, scope and budget before writing',async()=>{
 const response=await POST(request('session_status',{taskId:id}));assert.equal((await response.json()).result.sessions[0].taskId,id);assert.deepEqual(lookups.at(-1),[id,'alice']);
 const before=creates;assert.equal((await POST(request('start_session',{objective:'Analyze these replays',acceptanceCriteria:'Save evidence links',budgetUsd:26}))).status,400);
 assert.equal((await POST(request('start_session',{},createVoiceLease('bob','live-other')))).status,400);
 assert.equal((await POST(request('start_session',{objective:'Analyze these replays',acceptanceCriteria:'Save evidence links'},createVoiceLease('alice','live-other','league_other')))).status,400);
 assert.equal(creates,before);student={subjectId:'bob',token:'test-token'};
 const other=await POST(request('session_status',{taskId:id},createVoiceLease('bob','live-bob')));assert.deepEqual((await other.json()).result.sessions,[]);assert.deepEqual(lookups.at(-1),[id,'bob']);
});
