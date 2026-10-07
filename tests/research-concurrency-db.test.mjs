import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const url = process.env.TASK_TEST_DATABASE_URL;
const exec = promisify(execFile);
test('research allowance serializes competing connections and releases a closed cycle', { skip: !url }, async () => {
  const student = `concurrency-${randomUUID()}`, base = randomUUID();
  const sql = body => execFileSync('psql', [url, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: body, encoding: 'utf8' }).trim();
  try {
    const cycle = sql(`
      insert into students(subject_id,email,sealed_token) values('${student}','test@example.test','unused');
      insert into policy_versions(id,student_id,revision_number,revision_id,summary,source,ir,receipts)
      values('${base}','${student}',1,'${base}','baseline','base','{}','{}');
      select (research_create_cycle('${student}','create-cycle','Test concurrent starts','Observe atomic reservation','${base}')).id;`);
    sql(`select research_grant('${student}','${cycle}',24,1,now()+interval '1 day',true,5,'grant');`);
    const plans = [1, 2].map(i => sql(`select research_propose('${student}','${cycle}','plan-${i}','Test candidate ${i}','Inspect retreat behavior','Investigate the current evidence','[]',24,0,'preston');`));
    const results = await Promise.allSettled(plans.map(plan => exec('psql', [url, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
      `begin; select research_start_plan('${student}','${plan}'); select pg_sleep(0.15); commit;`])));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.match(results.find(r => r.status === 'rejected').reason.stderr, /Research allowance exhausted/);
    assert.equal(sql(`select calls_allocated||':'||games_allocated from research_cycles where id='${cycle}'`), '24:1');
    sql(`select research_control('${student}','${cycle}','close','close'); select research_resume_tasks();`);
    assert.equal(sql(`select calls_allocated||':'||games_allocated from research_cycles where id='${cycle}'`), '0:0');
    assert.equal(sql(`select count(*) from agent_tasks where student_id='${student}' and status not in ('completed','failed','canceled')`), '0');
  } finally {
    // Separate connections require committed fixtures. Cleanup is restricted to this generated student
    // in the disposable test database; bypass immutable-history triggers only for fixture removal.
    sql(`begin; set local session_replication_role=replica;
      delete from agent_task_events where task_id in(select id from agent_tasks where student_id='${student}');
      delete from research_events where student_id='${student}';
      delete from research_plans where student_id='${student}';
      delete from agent_tasks where student_id='${student}';
      delete from research_cycles where student_id='${student}';
      delete from preston_partnerships where student_id='${student}';
      delete from policy_versions where student_id='${student}';
      delete from students where subject_id='${student}'; commit;`);
  }
});
