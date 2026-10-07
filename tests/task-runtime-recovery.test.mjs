import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
mock.module('../lib/db.ts',{namedExports:{db:()=>{},studentToken:()=>{}}});
mock.module('../lib/tasks/store.ts',{namedExports:{rpc:()=>{}}});
const {failedRuntime}=await import('../lib/tasks/runtime-recovery.ts');
async function* events(types){for(const type of types)yield {type,data:{message:'Saved model unavailable'}};}
test('watchdog requires terminal failure, never mere inactivity or failed turns',async()=>{
 assert.equal(await failedRuntime(events(['turn.started','turn.failed','session.waiting'])),null);
 assert.equal(await failedRuntime(events(['turn.started','reasoning.appended'])),null);
 assert.equal(await failedRuntime(events(['session.failed'])),'Saved model unavailable');
 assert.equal(await failedRuntime(events(['session.failed','turn.started'])),null);
 await assert.rejects(failedRuntime((async function*(){yield {type:'turn.started'};throw Error('stream timeout');})()),/stream timeout/);
});
