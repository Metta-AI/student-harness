import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
let selection={model:'gpt-6-astra',effort:'xhigh'};
mock.module('eve',{namedExports:{defineDynamic:x=>x}});
mock.module('../lib/session-model.ts',{namedExports:{sessionModelSelection:async()=>selection}});
const {selectedModel}=await import('../agent/lib/selected-model.ts');
test('every saved model routes through Gateway with its exact model and effort, even with a legacy transport override',async()=>{
 const old=process.env.PRESTON_OPENAI_TRANSPORT;
 try{
  process.env.PRESTON_OPENAI_TRANSPORT='api';
  for(const [model,id] of [['gpt-6-astra','openai/gpt-6-astra'],['gpt-6.1-sol','openai/gpt-6.1-sol'],['claude-sonnet-5-5','anthropic/claude-sonnet-5.5'],['claude-opus-5-5','anthropic/claude-opus-5.5']]){
   selection={model,effort:'xhigh'};
   assert.deepEqual(await selectedModel.events['step.started']({}, {session:{auth:{}}}),{model:id,reasoning:'xhigh'});
  }
 }finally{if(old===undefined)delete process.env.PRESTON_OPENAI_TRANSPORT;else process.env.PRESTON_OPENAI_TRANSPORT=old;}
});
