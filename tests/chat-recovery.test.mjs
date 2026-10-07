import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isInactiveSession,sendWithSessionRecovery} from '../lib/chat-recovery.ts';
test('inactive session retries only the rejected message once after reset',async()=>{
 const events=[];
 await sendWithSessionRecovery(async recovered=>{events.push(recovered?'new-send':'old-send');if(!recovered)throw Object.assign(new Error('The session is no longer active.'),{code:'session_not_active'});},()=>events.push('reset'));
 assert.deepEqual(events,['old-send','reset','new-send']);
});
test('network, tool, and ambiguous errors never replay accepted work',async()=>{
 for(const message of ['Network error','Tool not found','Failed to send the session message.','Session is not ready']){
  let sends=0,resets=0;await assert.rejects(sendWithSessionRecovery(async()=>{sends++;throw Error(message);},()=>resets++));assert.equal(sends,1);assert.equal(resets,0);
 }
 assert.equal(isInactiveSession(Error('The session is no longer active.')),true);
});
test('a second inactive rejection stops instead of looping',async()=>{
 let sends=0,resets=0;await assert.rejects(sendWithSessionRecovery(async()=>{sends++;throw Error('The session is no longer active.');},()=>resets++));assert.equal(sends,2);assert.equal(resets,1);
});
