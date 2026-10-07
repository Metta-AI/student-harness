import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync,spawn} from 'node:child_process';
const url=process.env.TASK_TEST_DATABASE_URL;
const run=sql=>execFileSync('psql',[url,'-XqAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
const fixture=`insert into students(subject_id,email,sealed_token) values('daily-budget-test','budget@test','unused');
update students set research_budget_enforced=true where subject_id='daily-budget-test';
insert into agent_tasks(id,student_id,request_key,objective,acceptance_criteria,kind,max_games,max_model_calls,max_cost_usd)
values('90000000-0000-0000-0000-000000000001','daily-budget-test','daily-first','Inspect losses','Save evidence','research',0,100,25),
('90000000-0000-0000-0000-000000000002','daily-budget-test','daily-second','Inspect rivals','Save model','research',0,100,25);`;
const id="'90000000-0000-0000-0000-000000000001'", other="'90000000-0000-0000-0000-000000000002'";
test('daily allowance is shared, idempotent, retains unknown cost, and resumes only budget-parked tasks',{skip:!url},()=>{
 run(`begin;${fixture}
 do $$ declare i integer;budget jsonb;begin
 budget:=research_daily_budget('daily-budget-test');
 if (budget->>'limitUsd')::numeric<>25 then raise exception 'wrong daily default';end if;
 for i in 1..25 loop
  if not task_reserve_call(${id},0,'call-'||i) then raise exception 'early budget stop';end if;
 end loop;
 if not task_reserve_call(${id},0,'call-25') then raise exception 'idempotency lost';end if;
 perform task_record_usage(${id},'call-1',null);
 if task_reserve_call(${other},0,'blocked') then raise exception 'second session overspent';end if;
 if (select model_calls from agent_tasks where id=${other})<>0 then raise exception 'failed call counted';end if;
 perform task_record_usage(${id},'call-2',0.2);
 perform task_record_usage(${id},'call-2',9);
 budget:=research_daily_budget('daily-budget-test');
 if (budget->>'reportedUsd')::numeric<>0.2 or (budget->>'reservedUsd')::numeric<>24 then raise exception 'settlement wrong: %',budget;end if;
 -- Advance the accounting day and the waiting marker; no actual clock manipulation.
 update research_daily_usage set budget_day=budget_day-1 where student_id='daily-budget-test';
 update agent_tasks set checkpoint=jsonb_build_object('daily_budget_day',(now() at time zone 'America/Los_Angeles')::date-1) where id=${other};
 update agent_tasks set status='paused' where id=${id};
 perform task_claim_events();
 if (select status from agent_tasks where id=${other})<>'queued' then raise exception 'midnight recovery failed';end if;
 if (select status from agent_tasks where id=${id})<>'paused' then raise exception 'human pause lost';end if;
 if (research_daily_budget('daily-budget-test')->>'remainingUsd')::numeric<>25 then raise exception 'day did not reset';end if;
 end $$;rollback;`);
});
test('director calls share the allowance and hosted games are blocked before submission',{skip:!url},()=>{
 run(`begin;${fixture}
 insert into research_settings(student_id) values('daily-budget-test');
 insert into research_wakes(id,student_id,event_key,reason,status,token,lease_until)
 values('90000000-0000-0000-0000-000000000003','daily-budget-test','daily-wake','Inspect losses','running','90000000-0000-0000-0000-000000000004',now()+interval '10 minutes');
 do $$ declare budget jsonb;begin
 if not autoresearch_reserve_call('90000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000004','director-step') then raise exception 'director call denied';end if;
 update research_director_calls set cost_usd=0.5 where call_key='director-step';
 budget:=research_daily_budget('daily-budget-test');
 if (budget->>'reportedUsd')::numeric<>0.5 then raise exception 'director cost missing';end if;
 update students set daily_research_budget_usd=0 where subject_id='daily-budget-test';
 insert into policy_versions(id,student_id,revision_number,revision_id,summary,source,ir,receipts) values('90000000-0000-0000-0000-000000000005','daily-budget-test',1,'daily-base','baseline','base','{}','{}');
 update agent_tasks set base_version_id='90000000-0000-0000-0000-000000000005',kind='experiment',max_games=1,status='running',execution_key='exec',lease_until=now()+interval '5 minutes' where id=${id};
 if task_reserve_game(${id},'exec') then raise exception 'hosted game exceeded budget';end if;
 if (select games_requested from agent_tasks where id=${id})<>0 then raise exception 'denied game counted';end if;
 if (select status from agent_tasks where id=${id})<>'needs_input' then raise exception 'game work not parked';end if;
 if autoresearch_reserve_call('90000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000004','director-next') then raise exception 'director overspent';end if;
 if (select calls from research_wakes where event_key='daily-wake')<>1 then raise exception 'denied director call counted';end if;
 end $$;rollback;`);
});
test('concurrent sessions cannot reserve the same last dollar',{skip:!url},async()=>{
 const student='daily-race-'+process.pid;
 run(`insert into students(subject_id,email,sealed_token,daily_research_budget_usd,research_budget_enforced) values('${student}','race@test','unused',1,true);`);
 const reserve=key=>new Promise((resolve,reject)=>{
  const child=spawn('psql',[url,'-XqAt','-v','ON_ERROR_STOP=1']);let out='',err='';child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>err+=s);child.on('error',reject);child.on('close',code=>code?reject(Error(err)):resolve(out.trim()));
  child.stdin.end(`begin;select research_daily_reserve('${student}','${key}');select pg_sleep(0.1);commit;`);
 });
 try{const results=await Promise.all([reserve('a'),reserve('b')]);assert.deepEqual(results.sort(),['f','t']);}
 finally{run(`delete from research_daily_usage where student_id='${student}';delete from students where subject_id='${student}';`);}
});

test('tracking mode continues beyond daily and task dollar limits while retaining cost records',{skip:!url},()=>{
 run(`begin;${fixture}
 update students set research_budget_enforced=false where subject_id='daily-budget-test';
 do $$ declare b jsonb;begin
 if not task_reserve_call(${id},0,'expensive') then raise exception 'tracking call denied';end if;
 perform task_record_usage(${id},'expensive',75);
 if not task_reserve_call(${id},0,'continue') then raise exception 'task dollar cap still active';end if;
 if not task_reserve_call(${other},0,'parallel') then raise exception 'daily dollar cap still active';end if;
 b:=research_daily_budget('daily-budget-test');
 if b->>'mode'<>'tracking' or b->>'limitUsd' is not null or b->>'remainingUsd' is not null then raise exception 'tracking reported as capped';end if;
 if (b->>'reportedUsd')::numeric<>75 or (b->>'reservedUsd')::numeric<>2 then raise exception 'tracking lost accounting';end if;
 perform task_wait_daily_budget(${other});
 update agent_tasks set status='paused',reason='Paused by student' where id=${id};
 perform task_claim_events();
 if (select status from agent_tasks where id=${other})<>'queued' then raise exception 'dollar-blocked work stayed blocked';end if;
 if (select status from agent_tasks where id=${id})<>'paused' then raise exception 'human pause lost';end if;
 -- Re-enabling limits still fences further operations without erasing recorded costs.
 update students set research_budget_enforced=true where subject_id='daily-budget-test';
 if task_reserve_call(${other},(select generation from agent_tasks where id=${other}),'limited-again') then raise exception 'limits cannot be restored';end if;
 end $$;rollback;`);
});
