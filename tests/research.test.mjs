import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentMemory, cycleInputSchema, noteInputSchema } from '../lib/research/model.ts';
test('research: corrections and expired instructions leave history intact',()=>{
 const events=[{id:'a',kind:'position',actor:'preston',payload:{text:'First idea'},evidence:[]},{id:'b',kind:'position',actor:'preston',supersedes:'a',payload:{text:'Correction',finding:'inconclusive'},evidence:[]},{id:'c',kind:'instruction',actor:'human',payload:{text:'Spend freely',expiresAt:'2000-01-01T00:00:00Z'},evidence:[]}];
 assert.deepEqual(currentMemory(events).map(x=>x.id),['b']);assert.equal(events.length,3);
 assert.equal(currentMemory(events)[0].finding,'inconclusive');
});
test('research: an actionable question and baseline are required',()=>{
 assert.equal(cycleInputSchema.safeParse({question:'?',criteria:'win'}).success,false);
 assert.equal(noteInputSchema.safeParse({cycleId:'bad',text:'yes',finding:'proven'}).success,false);
});
