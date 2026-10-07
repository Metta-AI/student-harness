import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
let preferences={chatModel:'gpt-6-astra',reasoningEffort:'xhigh'}, filters={}, missing=false,failures=0,calls=0;
mock.module('../lib/preferences-store.ts',{namedExports:{userPreferences:async id=>{assert.equal(id,'alice');return preferences;}}});
mock.module('../lib/db.ts',{namedExports:{db:()=>({
 from(table){
  assert.equal(table,'agent_tasks');filters={};
  return {
   select(){return this;},abortSignal(){return this;},
   eq(k,v){filters[k]=v;return this;},
   async single(){calls++;if(failures-->0)return {error:{code:'57014',message:'statement timeout'}};return missing?{error:{message:'unavailable'}}:{data:{model_selection:{model:'gpt-6.1-sol',effort:'high'}}};}
  };
 }
})}});
const {sessionModelSelection}=await import('../lib/session-model.ts');
test('chat resolves saved model and effort while task work stays on its owned snapshot',async()=>{
 const chat={current:{authenticator:'student-harness',principalId:'alice'}};
 assert.deepEqual(await sessionModelSelection(chat),{model:'gpt-6-astra',effort:'xhigh'});
 const task={...chat,initiator:{authenticator:'task-runner',principalId:'alice',attributes:{taskId:'task-one'}}};
 assert.deepEqual(await sessionModelSelection(task),{model:'gpt-6.1-sol',effort:'high'});
 assert.deepEqual(filters,{id:'task-one',student_id:'alice'});
 preferences={chatModel:'claude-opus-5-5',reasoningEffort:'low'};
 assert.deepEqual(await sessionModelSelection(chat),{model:'claude-opus-5-5',effort:'low'});
 assert.deepEqual(await sessionModelSelection(task),{model:'gpt-6.1-sol',effort:'high'});
 missing=true;
 await assert.rejects(sessionModelSelection(task),/Could not load session model/);
});

test('internal dispatch snapshot survives DB outage and never switches models',async()=>{
 const before=calls;missing=true;
 const auth={initiator:{authenticator:'task-runner',principalId:'alice',attributes:{taskId:'task-one',model:'gpt-6-astra',effort:'xhigh'}}};
 assert.deepEqual(await sessionModelSelection(auth),{model:'gpt-6-astra',effort:'xhigh'});assert.equal(calls,before);
 await assert.rejects(sessionModelSelection({...auth,initiator:{...auth.initiator,attributes:{...auth.initiator.attributes,model:'invalid'}}}));
 assert.equal(calls,before);
});
test('legacy sessions retry transient model reads without falling back',async()=>{
 missing=false;failures=1;const before=calls;
 assert.deepEqual(await sessionModelSelection({initiator:{authenticator:'task-runner',principalId:'alice',attributes:{taskId:'task-one'}}}),{model:'gpt-6.1-sol',effort:'high'});
 assert.equal(calls,before+2);
});
