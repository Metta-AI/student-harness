-- Track spend without monetary stops by default. Preserve the configured allowance for later.
alter table students add column research_budget_enforced boolean not null default false;
create or replace function research_daily_budget(p_student text) returns jsonb language sql stable set search_path=public as $$
 select jsonb_build_object('enforced',s.research_budget_enforced,
  'mode',case when s.research_budget_enforced then 'limited' else 'tracking' end,
  'configuredLimitUsd',s.daily_research_budget_usd,
  'limitUsd',case when s.research_budget_enforced then s.daily_research_budget_usd end,
  'reportedUsd',coalesce(sum(u.cost_usd),0),
  'reservedUsd',coalesce(sum(case when u.cost_usd is null then u.reserved_usd else 0 end),0),
  'remainingUsd',case when s.research_budget_enforced then greatest(0,s.daily_research_budget_usd-coalesce(sum(coalesce(u.cost_usd,u.reserved_usd)),0)) end,
  'day',(now() at time zone 'America/Los_Angeles')::date,
  'resetsAt',(((now() at time zone 'America/Los_Angeles')::date+1)::timestamp at time zone 'America/Los_Angeles'))
 from students s left join research_daily_usage u on u.student_id=s.subject_id
 and u.budget_day=(now() at time zone 'America/Los_Angeles')::date
 where s.subject_id=p_student group by s.subject_id;
$$;
create or replace function research_daily_reserve(p_student text,p_key text,p_hold numeric default 1) returns boolean
language plpgsql set search_path=public as $$
declare budget jsonb;
begin
 if p_hold<=0 or p_hold is null then raise exception 'Invalid reservation';end if;
 perform pg_advisory_xact_lock(hashtextextended('research-budget:'||p_student,0));
 if exists(select 1 from research_daily_usage where student_id=p_student and operation_key=p_key) then return true;end if;
 budget:=research_daily_budget(p_student);
 if budget is null or ((budget->>'enforced')::boolean and (budget->>'remainingUsd')::numeric<p_hold) then return false;end if;
 insert into research_daily_usage(student_id,operation_key,reserved_usd) values(p_student,p_key,p_hold);
 return true;
end $$;

-- Keep execution/call-count bounds; dollar totals are informational in tracking mode.
create or replace function task_reserve_call_legacy(p_task uuid,p_generation integer,p_call text) returns boolean
language plpgsql set search_path=public as $$
declare t agent_tasks;
begin
 select * into t from agent_tasks where id=p_task for update;
 if not found or t.generation<>p_generation or t.status not in ('queued','running') or t.deadline_at<=now() then return false;end if;
 if exists(select 1 from agent_task_usage where task_id=p_task and call_key=p_call) then return true;end if;
 if t.model_calls>=t.max_model_calls or (t.reported_cost_usd>=t.max_cost_usd and (select research_budget_enforced from students where subject_id=t.student_id)) then
  update agent_tasks set status='needs_input',reason='Task model budget reached',generation=generation+1,
   execution_key=null,lease_until=null,updated_at=now() where id=p_task;
  return false;
 end if;
 insert into agent_task_usage(task_id,call_key) values(p_task,p_call);
 update agent_tasks set model_calls=model_calls+1,updated_at=now() where id=p_task;
 return true;
end $$;

-- Resume only work stopped by a monetary limit, never a human pause or unrelated question.
create or replace function task_claim_events() returns setof agent_task_events language plpgsql set search_path=public as $$
begin
 update agent_tasks t set status='queued',reason='Research cost tracking enabled',generation=generation+1,
  checkpoint=checkpoint-'daily_budget_day',attempts=0,updated_at=now()
 from students s where t.student_id=s.subject_id and not s.research_budget_enforced
 and t.status='needs_input' and t.deadline_at>now()
 and (t.reason='Daily research budget reached; resumes after midnight Pacific'
  or (t.reason='Task model budget reached' and t.model_calls<t.max_model_calls and t.reported_cost_usd>=t.max_cost_usd));
 update agent_tasks set status='queued',reason='Daily research budget renewed',generation=generation+1,
  checkpoint=checkpoint-'daily_budget_day',attempts=0,updated_at=now()
 where status='needs_input' and checkpoint->>'daily_budget_day'<(now() at time zone 'America/Los_Angeles')::date::text
 and deadline_at>now() and reason='Daily research budget reached; resumes after midnight Pacific';
 update research_wakes w set status='queued',token=null,lease_until=null,error=null
 from students s where w.student_id=s.subject_id and not s.research_budget_enforced
 and w.status='running' and w.token is null and w.error='Daily research budget reached';
 return query select * from task_claim_events_before_daily();
end $$;

create or replace function research_start_plan_cycle(p_student text,p_plan uuid,p_manual boolean default false)
returns uuid language plpgsql set search_path=public as $$
declare p research_plans; c research_cycles; task uuid; base uuid; memory jsonb;
begin
 select * into p from research_plans where id=p_plan and student_id=p_student;
 if not found then raise exception 'Experiment plan not found';end if;
 select * into c from research_cycles where id=p.cycle_id and student_id=p_student for update;
 select * into p from research_plans where id=p_plan for update;
 if p.task_id is not null then return p.task_id;end if;
 if p.status<>'proposed' then raise exception 'Experiment is not proposed';end if;
 if c.state<>'active' or c.expires_at<=now() or c.expires_at is null then raise exception 'Research allowance is paused or expired';end if;
 if not p_manual and not c.autonomy then raise exception 'Between-visit work is disabled';end if;
 if c.calls_allocated+p.max_calls>c.call_limit or c.games_allocated+1>c.game_limit then raise exception 'Research allowance exhausted';end if;
 if exists(select 1 from agent_tasks where kind='experiment' and student_id=p_student and status not in ('completed','failed','canceled')) then raise exception 'Another experiment is still active';end if;
 if exists(select 1 from workspace_files where student_id=p_student and path='draft/hero.bas') then raise exception 'An unsaved policy draft needs attention';end if;
 if (select research_budget_enforced from students where subject_id=p_student) and (select coalesce(sum(reported_cost_usd),0) from agent_tasks where cycle_id=c.id)>=c.cost_review_usd then raise exception 'Reported cost review threshold reached';end if;
 -- Stage 4 supplies the selected active baseline and contextual brief.
 base:=c.active_version_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'actor',e.actor,'kind',e.kind,'payload',e.payload,'evidence',e.evidence)),'[]') into memory
 from research_events e where e.student_id=p_student and e.cycle_id=c.id
 and e.kind in ('position','lesson','instruction','commitment','vocabulary','repair','salience','question')
 and not exists(select 1 from research_events s where s.supersedes=e.id)
 and (e.payload->>'expiresAt' is null or (e.payload->>'expiresAt')::timestamptz>now());
 insert into agent_tasks(student_id,request_key,objective,acceptance_criteria,base_version_id,max_model_calls,max_cost_usd,cycle_id,plan_id,deadline_at,checkpoint)
 values(p_student,'research:'||p.id,p.objective,p.criteria,base,p.max_calls,least(c.cost_review_usd,25),c.id,p.id,least(c.expires_at,now()+interval '7 days'),
 jsonb_build_object('research_brief',jsonb_build_object('cycleId',c.id,'question',c.question,'criteria',c.criteria,'baselineId',c.baseline_id,'rationale',p.rationale,'evidence',p.evidence,'memory',memory),
 'expected_latest_id',(select id from policy_versions where student_id=p_student order by revision_number desc limit 1))) returning id into task;
 if p.mode='baseline' then
  update agent_tasks set phase='upload',checkpoint=checkpoint||jsonb_build_object('research_mode','baseline','version_id',base) where id=task;
 end if;
 update research_cycles set calls_allocated=calls_allocated+p.max_calls,games_allocated=games_allocated+1,updated_at=now() where id=c.id;
 update research_plans set status='running',task_id=task where id=p.id;
 perform research_append(p_student,c.id,'reservation:'||task,'preston','allowance.reserved',jsonb_build_object('planId',p.id,'taskId',task,'modelCalls',p.max_calls,'hostedGames',1,'rationale',p.rationale),p.evidence);
 perform task_enqueue(task,'created:'||task,'task.created');
 return task;
end $$;

notify pgrst,'reload schema';
