import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(`${s}.ts`,c);throw e;}}});
let slots,calls,canceled;
mock.module('../lib/tasks/store.ts',{namedExports:{rpc:async(name,args)=>{
 calls.push({name,args});
 if(name==='task_model_slot')return slots.shift();
 return true;
}}});
const {default:hook}=await import('../agent/lib/tasks/budget-hook.ts');
const event={data:{turnId:'turn',stepIndex:1}};
function context(){return {session:{id:'session',auth:{initiator:{authenticator:'task-runner',attributes:{taskId:'99000000-0000-4000-8000-000000000001',studentId:'owner',generation:2}}}},cancel(){canceled=true;}};}
test('pacing waits before reserving a billable model call',async()=>{
 slots=[1,0];calls=[];canceled=false;
 await hook.events['step.started'](event,context());
 assert.deepEqual(calls.map(c=>c.name),['task_model_slot','task_model_slot','task_reserve_call']);
 assert.equal(calls[0].args.p_call,calls[2].args.p_call);assert.equal(canceled,false);
});
test('a task canceled while pacing never reserves or invokes its next model call',async()=>{
 slots=[1,-1];calls=[];canceled=false;
 await hook.events['step.started'](event,context());
 assert(canceled);assert(calls.every(c=>c.name==='task_model_slot'));
});
test('interactive chat is unaffected by background pacing',async()=>{
 calls=[];await hook.events['step.started'](event,{session:{auth:{initiator:{authenticator:'student'}}}});
 assert.deepEqual(calls,[]);
});
