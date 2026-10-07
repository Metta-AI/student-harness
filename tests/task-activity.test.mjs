import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taskActivity} from '../lib/tasks/activity.ts';
const task=(status,checkpoint={},reason=null)=>({status,checkpoint,reason,kind:'research'});
test('retry status is distinct from game waiting and stale historical errors',()=>{
 assert.equal(taskActivity(task('waiting',{provider_retry_at:'2026-10-07T16:00:00Z'})).label,'Retrying');
 assert.equal(taskActivity(task('queued',{},'Failed to load model')).label,'Retry queued');
 assert.equal(taskActivity(task('running',{runtime_error:'old problem'})).label,'Working');
 assert.equal(taskActivity(task('running'),true).label,'Recovering');
 assert.equal(taskActivity(task('completed'),true).label,'Completed');
 assert.equal(taskActivity(task('needs_input')).tone,'attention');
 assert.equal(taskActivity(task('waiting')).label,'Waiting');
});
