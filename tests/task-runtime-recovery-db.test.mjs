import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
const url=process.env.TASK_TEST_DATABASE_URL;
const id='99000000-0000-4000-8000-000000000041';
const fixture=`insert into students(subject_id,email,sealed_token) values('runtime-test','runtime@test','unused');
insert into agent_tasks(id,student_id,request_key,objective,acceptance_criteria,kind,max_games) values
('${id}','runtime-test','one','Research one','Evidence','research',0);
select task_claim('${id}','runtime-test',0,'exec','root');`;
function run(body){execFileSync('psql',[url,'-XqAt','-v','ON_ERROR_STOP=1'],{input:`begin;${fixture}${body}rollback;`,encoding:'utf8'});}
test('terminal runtime recovery preserves work, fences old execution and wakes once after cooldown',{skip:!url},()=>run(`
update agent_tasks set checkpoint='{"artifactId":"saved-evidence"}' where id='${id}';
do $$ begin
 if task_runtime_failed('unknown','network',false) then raise exception 'unknown session changed task';end if;
 if not task_runtime_failed('root','Could not load session model selection',false) then raise exception 'not recovered';end if;
 if task_runtime_failed('root','duplicate',false) then raise exception 'duplicate recovery';end if;
 if not exists(select 1 from agent_tasks where id='${id}' and status='waiting' and generation=1 and execution_key is null and lease_until is null and attempts=0 and checkpoint->>'artifactId'='saved-evidence' and checkpoint->>'runtime_retries'='1') then raise exception 'bad recovery';end if;
 perform task_claim_events();
 if (select status from agent_tasks where id='${id}')<>'waiting' then raise exception 'cooldown ignored';end if;
 update agent_tasks set checkpoint=jsonb_set(checkpoint,'{provider_retry_at}',to_jsonb((now()-interval '1 second')::text)) where id='${id}';
 perform task_claim_events();
 if (select status from agent_tasks where id='${id}')<>'queued' then raise exception 'not resumed';end if;
 -- Even before replacement dispatch, the old failure cannot consume another retry.
 if task_runtime_failed('root','stale failure',false) then raise exception 'stale failure accepted';end if;
 end $$;`));
test('recovery respects paused/completed work and surfaces repeated failures',{skip:!url},()=>run(`
do $$ begin
 perform task_control('${id}','runtime-test','pause');
 if task_runtime_failed('root','network',false) then raise exception 'paused task resumed';end if;
 update agent_tasks set status='running',checkpoint='{"runtime_retries":4}',execution_key='new',lease_until=now()+interval '30 minutes' where id='${id}';
 perform task_runtime_failed('root','network',false);
 if (select status from agent_tasks where id='${id}')<>'needs_input' then raise exception 'unbounded retries';end if;
 update agent_tasks set status='completed' where id='${id}';
 if task_runtime_failed('root','network',false) then raise exception 'completed task resumed';end if;
 if has_function_privilege('authenticated','task_runtime_failed(text,text,boolean)','execute') then raise exception 'client can forge failures';end if;
 end $$;`));
test('execution history retains attempts that failed before any model usage',{skip:!url},()=>run(`
do $$ begin
 perform task_runtime_failed('root','network',false);
 update agent_tasks set session_id='replacement',generation=2 where id='${id}';
 if (select count(*) from agent_task_executions where task_id='${id}')<>2 then raise exception 'missing attempt';end if;
 update agent_tasks set session_id='replacement' where id='${id}';
 if (select count(*) from agent_task_executions where task_id='${id}')<>2 then raise exception 'duplicate attempt';end if;
 if exists(select 1 from agent_task_usage where task_id='${id}') then raise exception 'test unexpectedly used model';end if;
 if has_table_privilege('authenticated','agent_task_executions','SELECT') then raise exception 'execution history exposed';end if;
 end $$;`));
