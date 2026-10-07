-- One allowance per account/day, shared by all research workers and the director.
-- Reservations are accounting holds, not provider price estimates or billing caps.
alter table students add column daily_research_budget_usd numeric not null default 25
 check(daily_research_budget_usd between 0 and 1000);
create table research_daily_usage (
 student_id text not null references students(subject_id),
 operation_key text not null,
 budget_day date not null default (now() at time zone 'America/Los_Angeles')::date,
 reserved_usd numeric not null check(reserved_usd>0),
 cost_usd numeric check(cost_usd>=0),
 created_at timestamptz not null default now(),
 primary key(student_id,operation_key)
);
create index research_daily_usage_day on research_daily_usage(student_id,budget_day);
alter table research_daily_usage enable row level security;
revoke all on research_daily_usage from public,anon,authenticated;
grant select,insert,update on research_daily_usage to service_role;

create function research_daily_budget(p_student text) returns jsonb language sql stable set search_path=public as $$
 select jsonb_build_object('limitUsd',s.daily_research_budget_usd,
  'reportedUsd',coalesce(sum(u.cost_usd),0),
  'reservedUsd',coalesce(sum(case when u.cost_usd is null then u.reserved_usd else 0 end),0),
  'remainingUsd',greatest(0,s.daily_research_budget_usd-coalesce(sum(coalesce(u.cost_usd,u.reserved_usd)),0)),
  'day',(now() at time zone 'America/Los_Angeles')::date,
  'resetsAt',(((now() at time zone 'America/Los_Angeles')::date+1)::timestamp at time zone 'America/Los_Angeles'))
 from students s left join research_daily_usage u on u.student_id=s.subject_id
 and u.budget_day=(now() at time zone 'America/Los_Angeles')::date
 where s.subject_id=p_student group by s.subject_id;
$$;
create function research_daily_reserve(p_student text,p_key text,p_hold numeric default 1) returns boolean
language plpgsql set search_path=public as $$
declare budget jsonb;
begin
 if p_hold<=0 or p_hold is null then raise exception 'Invalid reservation';end if;
 -- Serialize only this account's budget ledger, never hold a transaction across a provider call.
 perform pg_advisory_xact_lock(hashtextextended('research-budget:'||p_student,0));
 if exists(select 1 from research_daily_usage where student_id=p_student and operation_key=p_key) then return true;end if;
 budget:=research_daily_budget(p_student);
 if budget is null or (budget->>'remainingUsd')::numeric<p_hold then return false;end if;
 insert into research_daily_usage(student_id,operation_key,reserved_usd) values(p_student,p_key,p_hold);
 return true;
end $$;
create function research_daily_settle(p_student text,p_key text,p_cost numeric) returns void
language plpgsql set search_path=public as $$
begin
 -- Missing usage keeps the hold. Never count an unpriced operation as free.
 if p_cost is null then return;end if;
 if p_cost<0 then raise exception 'Invalid cost';end if;
 perform pg_advisory_xact_lock(hashtextextended('research-budget:'||p_student,0));
 update research_daily_usage set cost_usd=p_cost where student_id=p_student and operation_key=p_key and cost_usd is null;
end $$;
create function task_wait_daily_budget(p_task uuid) returns void language sql set search_path=public as $$
 update agent_tasks set status='needs_input',reason='Daily research budget reached; resumes after midnight Pacific',
  checkpoint=checkpoint||jsonb_build_object('daily_budget_day',(now() at time zone 'America/Los_Angeles')::date),
  generation=generation+1,execution_key=null,lease_until=null,updated_at=now() where id=p_task;
$$;

alter function task_reserve_call(uuid,integer,text) rename to task_reserve_call_before_daily;
create function task_reserve_call(p_task uuid,p_generation integer,p_call text) returns boolean
language plpgsql security definer set search_path=public as $$
declare t agent_tasks;
begin
 select * into t from agent_tasks where id=p_task for update;
 if not found then return false;end if;
 begin
  if not task_reserve_call_before_daily(p_task,p_generation,p_call) then return false;end if;
  if not research_daily_reserve(t.student_id,'task:'||p_task||':'||p_call) then raise sqlstate 'P2500';end if;
 exception when sqlstate 'P2500' then
  -- Roll back the per-task call reservation, then park the task without losing its checkpoint.
  perform task_wait_daily_budget(p_task);return false;
 end;
 return true;
end $$;
alter function task_record_usage(uuid,text,numeric) rename to task_record_usage_before_daily;
create function task_record_usage(p_task uuid,p_call text,p_cost numeric) returns void
language plpgsql set search_path=public as $$
declare t agent_tasks;
begin
 select * into t from agent_tasks where id=p_task for update;
 if not found then return;end if;
 perform task_record_usage_before_daily(p_task,p_call,p_cost);
 perform research_daily_settle(t.student_id,'task:'||p_task||':'||p_call,p_cost);
end $$;

alter function task_reserve_game(uuid,text) rename to task_reserve_game_before_daily;
create function task_reserve_game(p_task uuid,p_execution text) returns boolean
language plpgsql security definer set search_path=public as $$
declare t agent_tasks;
begin
 select * into t from agent_tasks where id=p_task for update;
 if not found then return false;end if;
 begin
  perform task_reserve_game_before_daily(p_task,p_execution);
  if not research_daily_reserve(t.student_id,'game:'||p_task) then raise sqlstate 'P2500';end if;
 exception when sqlstate 'P2500' then
  perform task_wait_daily_budget(p_task);return false;
 end;
 return true;
end $$;

alter function autoresearch_reserve_call(uuid,uuid,text) rename to autoresearch_reserve_call_before_daily;
create function autoresearch_reserve_call(p_wake uuid,p_token uuid,p_call text) returns boolean
language plpgsql set search_path=public as $$
declare w research_wakes;
begin
 select * into w from research_wakes where id=p_wake for update;
 if not found then return false;end if;
 begin
  if not autoresearch_reserve_call_before_daily(p_wake,p_token,p_call) then return false;end if;
  if not research_daily_reserve(w.student_id,'director:'||p_call) then raise sqlstate 'P2500';end if;
 exception when sqlstate 'P2500' then
  update research_wakes set token=null,lease_until=(((now() at time zone 'America/Los_Angeles')::date+1)::timestamp at time zone 'America/Los_Angeles'),
   attempts=greatest(0,attempts-1),error='Daily research budget reached' where id=p_wake;
  return false;
 end;
 return true;
end $$;
create function research_daily_director_cost() returns trigger language plpgsql set search_path=public as $$
begin
 perform research_daily_settle((select student_id from research_wakes where id=new.wake_id),'director:'||new.call_key,new.cost_usd);
 return new;
end $$;
create trigger research_daily_director_cost after update of cost_usd on research_director_calls
for each row execute function research_daily_director_cost();

alter function task_claim_events() rename to task_claim_events_before_daily;
create function task_claim_events() returns setof agent_task_events language plpgsql set search_path=public as $$
begin
 -- Only budget-parked work resumes. A user's pause/cancel or an unrelated question stays put.
 update agent_tasks set status='queued',reason='Daily research budget renewed',generation=generation+1,
  checkpoint=checkpoint-'daily_budget_day',attempts=0,updated_at=now()
 where status='needs_input' and checkpoint->>'daily_budget_day'<(now() at time zone 'America/Los_Angeles')::date::text
 and deadline_at>now() and reason='Daily research budget reached; resumes after midnight Pacific';
 return query select * from task_claim_events_before_daily();
end $$;

revoke all on function task_reserve_call_before_daily(uuid,integer,text),task_record_usage_before_daily(uuid,text,numeric),
 task_reserve_game_before_daily(uuid,text),autoresearch_reserve_call_before_daily(uuid,uuid,text),task_claim_events_before_daily()
 from public,anon,authenticated,service_role;
revoke all on function research_daily_budget(text),research_daily_reserve(text,text,numeric),research_daily_settle(text,text,numeric),
 task_wait_daily_budget(uuid),task_reserve_call(uuid,integer,text),task_record_usage(uuid,text,numeric),task_reserve_game(uuid,text),
 autoresearch_reserve_call(uuid,uuid,text),research_daily_director_cost(),task_claim_events() from public,anon,authenticated;
-- Existing non-definer wrappers execute as service_role. Keep their internal helpers service-only.
grant execute on function task_record_usage_before_daily(uuid,text,numeric),autoresearch_reserve_call_before_daily(uuid,uuid,text),task_claim_events_before_daily(),
 research_daily_budget(text),research_daily_reserve(text,text,numeric),research_daily_settle(text,text,numeric),task_wait_daily_budget(uuid),
 task_reserve_call(uuid,integer,text),task_record_usage(uuid,text,numeric),task_reserve_game(uuid,text),autoresearch_reserve_call(uuid,uuid,text),task_claim_events() to service_role;
notify pgrst,'reload schema';
