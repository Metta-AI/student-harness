import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applyTranscriptEvent} from '../lib/tasks/transcript.ts';
const event=(type,data,id='1')=>({type,data,meta:{id,at:'2026-10-06T20:00:00Z'}});
test('session transcript deduplicates tools and messages and keeps failed outputs',()=>{
 const rows=new Map();const request=event('actions.requested',{actions:[{kind:'tool-call',callId:'c1',toolName:'softmax_cli',input:{args:['results']}}]});
 applyTranscriptEvent(rows,'session-a',request);applyTranscriptEvent(rows,'session-a',request);
 assert.equal(rows.size,1);assert.equal([...rows.values()][0].state,'running');
 const result=event('action.result',{result:{kind:'tool-result',callId:'c1',toolName:'softmax_cli',output:'Unavailable',isError:true}},'2');
 applyTranscriptEvent(rows,'session-a',result);assert.equal(rows.size,1);assert.equal([...rows.values()][0].state,'failed');assert.deepEqual([...rows.values()][0].input,{args:['results']});
 applyTranscriptEvent(rows,'session-b',request);assert.equal(rows.size,2,'Parallel workers must not collide');
 const message=event('message.completed',{message:'Evidence checked.'},'3');applyTranscriptEvent(rows,'session-a',message);applyTranscriptEvent(rows,'session-a',message);assert.equal(rows.size,3);
});
test('session transcript excludes internal reasoning, credentials and dispatch prompts',()=>{
 const rows=new Map();
 for(const type of ['reasoning.appended','reasoning.completed','authorization.required','message.received','session.started'])applyTranscriptEvent(rows,'session',event(type,{reasoning:'private',message:'internal dispatch',token:'secret'}));
 assert.equal(rows.size,0);
 applyTranscriptEvent(rows,'session',event('result.completed',{result:{summary:'Verified.',evidence:['episode:1']}}));assert.equal(rows.size,1);
});
test('turn and session failure render one incident with both diagnostic contexts',()=>{
 const rows=new Map(),base={code:'MODEL_SELECTION_FAILED',message:'Could not load session model selection',details:{errorId:'same-error'}};
 applyTranscriptEvent(rows,'session',event('turn.failed',{...base,turnId:'turn_0',sequence:0},'turn-error'));
 applyTranscriptEvent(rows,'session',event('session.failed',{...base,sessionId:'session'},'session-error'));
 assert.equal(rows.size,1);const incident=[...rows.values()][0];
 assert.equal(incident.terminal,true);assert.equal(incident.output.turnId,'turn_0');assert.equal(incident.output.sessionId,'session');
 assert.equal(incident.text,'The saved model could not be loaded.');
 applyTranscriptEvent(rows,'other-session',event('session.failed',{...base,sessionId:'other-session'},'other'));
 assert.equal(rows.size,2,'Distinct executions remain inspectable');
});
