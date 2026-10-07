import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";

// Run only against an explicitly supplied disposable PostgreSQL database.
const url = process.env.TASK_TEST_DATABASE_URL;
function sql(body) {
  return execFileSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-tA"], { input: `begin;\n${fixture}\n${body}\nrollback;`, encoding: "utf8" });
}
const fixture = `
insert into students(subject_id,email,sealed_token) values('task-test','task@example.test','unused');
insert into policy_versions(id,student_id,revision_number,revision_id,summary,source,ir,receipts)
values('10000000-0000-0000-0000-000000000001','task-test',1,'base','baseline','base source','{}','{}');
insert into agent_tasks(id,student_id,request_key,objective,acceptance_criteria,base_version_id)
values('20000000-0000-0000-0000-000000000001','task-test','test-key','Improve behavior','Report evidence','10000000-0000-0000-0000-000000000001');
`;
const task = "'20000000-0000-0000-0000-000000000001'";
const claim = `select task_claim(${task},'task-test',0,'exec-1','session-1');`;
function check(name, body) { test(name, { skip: !url }, () => { assert.doesNotThrow(() => sql(body)); }); }
check("database: duplicate dispatches cannot claim the same task twice", `
${claim}
do $$ declare t agent_tasks; begin
  t := task_claim(${task},'task-test',0,'exec-2','session-2');
  if t.id is not null then raise exception 'duplicate claimed task'; end if;
  t := task_claim(${task},'task-test',0,'exec-1','session-1');
  if t.attempts <> 1 then raise exception 'replay incremented attempts'; end if;
end $$;`);
check("database: ownership, pause and resume fence old executions", `
${claim}
do $$ begin
  begin perform task_control(${task},'other-student','cancel'); raise exception 'ownership bypass';
  exception when others then if sqlerrm <> 'Task not found' then raise; end if; end;
  perform task_control(${task},'task-test','pause');
  begin perform task_checkpoint(${task},'exec-1','select','{}'); raise exception 'stale write';
  exception when others then if sqlerrm <> 'Task execution is no longer active' then raise; end if; end;
  perform task_control(${task},'task-test','resume','New observation');
  if (task_claim(${task},'task-test',0,'old','old-session')).id is not null then raise exception 'stale generation claimed'; end if;
  if (task_claim(${task},'task-test',2,'new','new-session')).id is null then raise exception 'resume failed'; end if;
end $$;`);
check("database: terminal game and wake event are atomic and deduplicated", `
${claim}
select task_checkpoint(${task},'exec-1','evaluate','{}','waiting');
insert into experiments(student_id,policy_version_id,xp_request_id,title,status,task_id,summary)
values('task-test','10000000-0000-0000-0000-000000000001','xp-test','Test','completed',${task},'{"games_completed":1}');
update experiments set status='completed' where xp_request_id='xp-test';
do $$ begin
  if (select status from agent_tasks where id=${task})<>'queued' then raise exception 'not woken'; end if;
  if (select count(*) from agent_task_events where task_id=${task} and kind='game.finished')<>1 then raise exception 'duplicate event'; end if;
end $$;`);
check("database: result arriving before wait is not lost", `
${claim}
insert into experiments(student_id,policy_version_id,xp_request_id,title,status,task_id,summary)
values('task-test','10000000-0000-0000-0000-000000000001','xp-test','Test','completed',${task},'{"games_completed":1}');
select task_checkpoint(${task},'exec-1','evaluate','{}','waiting');
do $$ begin if (select status from agent_tasks where id=${task})<>'queued' then raise exception 'lost early result'; end if; end $$;`);
check("database: a terminal status without statistics stays parked for reconciliation", `
${claim}
insert into experiments(student_id,policy_version_id,xp_request_id,title,status,task_id)
values('task-test','10000000-0000-0000-0000-000000000001','xp-test','Test','completed',${task});
select task_checkpoint(${task},'exec-1','evaluate','{}','waiting');
do $$ begin if (select status from agent_tasks where id=${task})<>'waiting' then raise exception 'premature wake'; end if; end $$;`);
check("database: late results cannot restart a paused or canceled task", `
${claim}
select task_control(${task},'task-test','pause');
insert into experiments(student_id,policy_version_id,xp_request_id,title,status,task_id,summary)
values('task-test','10000000-0000-0000-0000-000000000001','xp-test','Test','completed',${task},'{}');
do $$ begin if (select status from agent_tasks where id=${task})<>'paused' then raise exception 'pause lost'; end if; end $$;
select task_control(${task},'task-test','resume');
do $$ begin if (select status from agent_tasks where id=${task})<>'queued' then raise exception 'resume lost event'; end if; end $$;
select task_control(${task},'task-test','cancel');
update experiments set summary='{}' where xp_request_id='xp-test';
do $$ begin if (select status from agent_tasks where id=${task})<>'canceled' then raise exception 'cancellation lost'; end if; end $$;`);
check("database: model reservations and reported costs are deduplicated across retries", `
do $$ begin
  if not task_reserve_call(${task},0,'model-1') then raise exception 'call denied'; end if;
  perform task_reserve_call(${task},0,'model-1');
  perform task_record_usage(${task},'model-1',0.5);
  perform task_record_usage(${task},'model-1',0.5);
  if (select model_calls from agent_tasks where id=${task})<>1 then raise exception 'duplicate call accounting'; end if;
  if (select reported_cost_usd from agent_tasks where id=${task})<>0.5 then raise exception 'duplicate cost'; end if;
  update agent_tasks set max_model_calls=6,model_calls=6 where id=${task};
  if task_reserve_call(${task},0,'model-2') then raise exception 'budget bypass'; end if;
  if (select status from agent_tasks where id=${task})<>'needs_input' then raise exception 'budget did not stop task'; end if;
end $$;`);
check("database: game reservation survives interrupted external requests", `
${claim}
select task_reserve_game(${task},'exec-1');
select task_reserve_game(${task},'exec-1');
do $$ begin if (select games_requested from agent_tasks where id=${task})<>1 then raise exception 'duplicate game reservation'; end if; end $$;`);
check("database: stale proposals cannot overwrite a newer canonical policy", `
${claim}
insert into policy_versions(student_id,revision_number,revision_id,summary,source,ir,receipts) values('task-test',2,'newer','new','new','{}','{}');
do $$ begin
  begin perform task_save_policy(${task},'exec-1','{}','test'); raise exception 'stale save accepted';
  exception when others then if sqlerrm not like 'Policy changed%' then raise; end if; end;
end $$;`);
check("database: policy save and checkpoint commit together and replay returns same revision", `
${claim}
do $$ declare first_id uuid; second_id uuid; begin
  first_id := task_save_policy(${task},'exec-1','{"revisionId":"next","source":"next source","ir":{"update":{"revision":2,"parent":"base"}},"receipts":{}}','test');
  second_id := task_save_policy(${task},'exec-1','{}','test');
  if first_id<>second_id then raise exception 'save duplicated'; end if;
  if (select phase from agent_tasks where id=${task})<>'upload' then raise exception 'save not checkpointed'; end if;
  if (select count(*) from policy_versions where student_id='task-test')<>2 then raise exception 'duplicate version'; end if;
end $$;`);
check("database: expired lease recovers with a new generation and bounded retries", `
${claim}
update agent_tasks set lease_until=now()-interval '1 second' where id=${task};
select count(*) from task_claim_events();
do $$ begin
  if (select status from agent_tasks where id=${task})<>'queued' then raise exception 'not recovered'; end if;
  if (select generation from agent_tasks where id=${task})<>1 then raise exception 'old worker not fenced'; end if;
end $$;
update agent_tasks set status='running',attempts=max_attempts,lease_until=now()-interval '1 second' where id=${task};
select count(*) from task_claim_events();
do $$ begin if (select status from agent_tasks where id=${task})<>'failed' then raise exception 'retry limit ignored'; end if; end $$;`);
check("database: browser roles cannot invoke coordinator RPCs", `
do $$ begin
  if has_function_privilege('anon','task_claim(uuid,text,integer,text,text)','EXECUTE') then raise exception 'anon can claim'; end if;
  if has_function_privilege('authenticated','task_save_policy(uuid,text,jsonb,text)','EXECUTE') then raise exception 'browser can save'; end if;
end $$;`);
check("database: a paused worker cannot publish stale output after resume", `
${claim}
select task_worker(${task},'exec-1','proposal:0','Proposal');
select task_control(${task},'task-test','pause');
select task_control(${task},'task-test','resume');
select task_claim(${task},'task-test',2,'exec-2','session-2');
select task_worker(${task},'exec-2','proposal:0','Proposal',true,'{"summary":"new"}');
do $$ begin
  begin perform task_worker(${task},'exec-1','proposal:0','Proposal',true,'{"summary":"stale"}'); raise exception 'stale worker accepted';
  exception when others then if sqlerrm <> 'Task execution is no longer active' then raise; end if; end;
  if (select output->>'summary' from agent_task_workers where task_id=${task} and worker_key='proposal:0')<>'new' then raise exception 'worker result overwritten'; end if;
end $$;`);

check('database: concurrent research needs no policy and does not claim the policy writer slot', `
insert into agent_tasks(id,student_id,request_key,kind,objective,acceptance_criteria,max_games)
values('20000000-0000-0000-0000-000000000002','task-test','research-one','research','Inspect replays','Report evidence',0),
('20000000-0000-0000-0000-000000000003','task-test','research-two','research','Model opponent','Save grounded IR',0);
do $$ begin
 if (select count(*) from agent_tasks where student_id='task-test')<>3 then raise exception 'Research not parallel';end if;
 begin
 insert into agent_tasks(student_id,request_key,objective,acceptance_criteria,base_version_id)
 values('task-test','another-writer','Change policy','Report evidence','10000000-0000-0000-0000-000000000001');
 raise exception 'Concurrent policy writer accepted';
 exception when unique_violation then null;end;
end $$;`);
check('database: redirect preserves checkpoints, fences old work, and queues a durable wake', `
${claim}
select task_checkpoint(${task},'exec-1','propose','{"research_progress":{"summary":"Collected evidence"}}');
do $$ declare t agent_tasks; begin
 begin perform task_steer(${task},'other-student','Wrong user');raise exception 'Ownership bypass';
 exception when others then if sqlerrm<>'Task not found' then raise;end if;end;
 t:=task_steer(${task},'task-test','Focus on the latest opponent.');
 if t.status<>'queued' or t.generation<>1 or t.checkpoint->'research_progress'->>'summary'<>'Collected evidence' then raise exception 'Lost state';end if;
 if t.checkpoint->>'student_note'<>'Focus on the latest opponent.' then raise exception 'Missing direction';end if;
 if not exists(select 1 from agent_task_events where task_id=t.id and kind='task.steered') then raise exception 'Missing durable event';end if;
 begin perform task_checkpoint(${task},'exec-1','done','{}','completed');raise exception 'Stale worker completed';
 exception when others then if sqlerrm<>'Task execution is no longer active' then raise;end if;end;
 if has_function_privilege('authenticated','task_steer(uuid,text,text)','EXECUTE') then raise exception 'Browser can bypass route';end if;
end $$;`);

check('database: routing a research session atomically claims a single policy writer', `
insert into agent_tasks(id,student_id,request_key,kind,objective,acceptance_criteria,max_games)
values('20000000-0000-0000-0000-000000000002','task-test','auto-route','research','Improve retreat behavior','Test one change',0);
select task_claim('20000000-0000-0000-0000-000000000002','task-test',0,'route-exec','route-session');
do $$ declare t agent_tasks; begin
 t:=task_route('20000000-0000-0000-0000-000000000002','route-exec','experiment','Test change');
 if t.status<>'needs_input' or t.kind<>'research' then raise exception 'Competing writer accepted';end if;
 perform task_control(${task},'task-test','cancel');
 perform task_control(t.id,'task-test','resume');
 select * into t from agent_tasks where id=t.id;
 perform task_claim(t.id,'task-test',t.generation,'route-exec-2','route-session-2');
 t:=task_route(t.id,'route-exec-2','experiment','Test change');
 if t.kind<>'experiment' or t.max_games<>1 or t.base_version_id is null then raise exception 'Route not persisted';end if;
 begin perform task_route(t.id,'stale-exec','research','Stale');raise exception 'Stale route accepted';
 exception when others then if sqlerrm<>'Task execution is no longer active' then raise;end if;end;
end $$;`);

check('database: session history preserves directions and lifecycle changes but not heartbeat noise', `
${claim}
select task_checkpoint(${task},'exec-1','propose','{"research_progress":{"summary":"Reading league results"}}');
select task_steer(${task},'task-test','Compare only recent episodes.');
do $$ begin
 if not exists(select 1 from agent_task_history where task_id=${task} and kind='direction' and content->>'text'='Compare only recent episodes.') then raise exception 'Direction not recorded';end if;
 if not exists(select 1 from agent_task_history where task_id=${task} and kind='progress') then raise exception 'Progress not recorded';end if;
 if exists(select 1 from agent_task_history where task_id=${task} and content::text like '%sealed_token%') then raise exception 'Credentials recorded';end if;
 if has_table_privilege('authenticated','agent_task_history','SELECT') then raise exception 'Browser bypasses owner lookup';end if;
end $$;`);
