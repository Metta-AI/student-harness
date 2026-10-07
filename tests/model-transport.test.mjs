import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
let selection={model:'gpt-6-astra',effort:'xhigh'};
mock.module('eve',{namedExports:{defineDynamic:x=>x}});
mock.module('eve/models/openai',{namedExports:{openai:id=>`api:${id}`,chatgpt:id=>`subscription:${id}`}});
mock.module('eve/models/anthropic',{namedExports:{anthropic:id=>`anthropic:${id}`}});
mock.module('../lib/session-model.ts',{namedExports:{sessionModelSelection:async()=>selection}});
const {selectedModel}=await import('../agent/lib/selected-model.ts');
test('local subscription transport keeps exact model and effort; deployment requires API credentials',async()=>{
 const env=process.env.NODE_ENV,transport=process.env.PRESTON_OPENAI_TRANSPORT;
 try{
 process.env.NODE_ENV='development';delete process.env.PRESTON_OPENAI_TRANSPORT;
 const resolve=()=>selectedModel.events['step.started']({}, {session:{auth:{}}});
 assert.deepEqual(await resolve(),{model:'api:gpt-6-astra',reasoning:'xhigh'});
 process.env.PRESTON_OPENAI_TRANSPORT='chatgpt';
 assert.deepEqual(await resolve(),{model:'subscription:gpt-6-astra',reasoning:'xhigh',modelContextWindowTokens:1050000});
 process.env.NODE_ENV='production';await assert.rejects(resolve(),/local only/);
 selection={model:'claude-opus-5-5',effort:'high'};
 assert.deepEqual(await resolve(),{model:'anthropic:claude-opus-5-5',reasoning:'high'});
 }finally{if(env===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=env;if(transport===undefined)delete process.env.PRESTON_OPENAI_TRANSPORT;else process.env.PRESTON_OPENAI_TRANSPORT=transport;}
});
