-- Tasks belong to students, not conversations. All access is through the server.
create table if not exists public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  student_id text not null references public.students(subject_id) on delete cascade,
  request_key text not null,
  objective text not null,
  acceptance_criteria text not null,
  origin_session_id text,
  base_version_id uuid not null references public.policy_versions(id),
  status text not null default 'queued' check (status in ('queued','running','waiting','paused','needs_input','completed','failed','canceled')),
  phase text not null default 'propose' check (phase in ('propose','select','save','upload','request_game','evaluate','done')),
  checkpoint jsonb not null default '{}',
  result jsonb,
  reason text,
  generation integer not null default 0,
  execution_key text,
  lease_until timestamptz,
  session_id text,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  model_calls integer not null default 0,
  max_model_calls integer not null default 24 check (max_model_calls between 6 and 100),
  reported_cost_usd numeric not null default 0,
  cost_reports integer not null default 0,
  max_cost_usd numeric not null default 5 check (max_cost_usd > 0 and max_cost_usd <= 25),
  games_requested integer not null default 0,
  max_games integer not null default 1 check (max_games = 1),
  deadline_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id, request_key)
);
-- Serialize autonomous policy writers per student, including paused tasks.
create unique index if not exists agent_tasks_one_active_student on public.agent_tasks(student_id)
  where status not in ('completed','failed','canceled');
create table if not exists public.agent_task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.agent_tasks(id) on delete cascade,
  event_key text not null unique,
  kind text not null,
  payload jsonb not null default '{}',
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  delivery_token uuid,
  delivered_at timestamptz,
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists agent_task_events_pending on public.agent_task_events(available_at) where delivered_at is null;
create table if not exists public.agent_task_workers (
  task_id uuid not null references public.agent_tasks(id) on delete cascade,
  worker_key text not null,
  role text not null,
  status text not null check (status in ('running','completed','failed')),
  output jsonb,
  updated_at timestamptz not null default now(),
  primary key(task_id, worker_key)
);
create table if not exists public.agent_task_usage (
  task_id uuid not null references public.agent_tasks(id) on delete cascade,
  call_key text not null,
  cost_usd numeric,
  settled boolean not null default false,
  primary key(task_id, call_key)
);
alter table public.experiments add column if not exists task_id uuid references public.agent_tasks(id);
create unique index if not exists experiments_one_task_game on public.experiments(task_id) where task_id is not null;
alter table public.agent_tasks enable row level security;
alter table public.agent_task_events enable row level security;
alter table public.agent_task_workers enable row level security;
alter table public.agent_task_usage enable row level security;

create or replace function public.task_enqueue(p_task uuid, p_key text, p_kind text, p_payload jsonb default '{}') returns void
language sql set search_path = public as $$
  insert into agent_task_events(task_id,event_key,kind,payload) values(p_task,p_key,p_kind,p_payload)
  on conflict(event_key) do nothing;
$$;

-- Polling and future webhooks both use updateExperiment; event creation is in the same transaction.
create or replace function public.task_experiment_event() returns trigger language plpgsql set search_path = public as $$
begin
  if new.task_id is not null and new.summary is not null and new.status in ('completed','failed','canceled','cancelled') then
    update agent_tasks set status = 'queued', reason = 'Hosted result received', updated_at = now()
      where id = new.task_id and status = 'waiting';
    perform task_enqueue(new.task_id, 'game:' || new.xp_request_id || ':' || new.status,
      'game.finished', jsonb_build_object('xp_request_id',new.xp_request_id,'status',new.status));
  end if;
  return new;
end $$;
drop trigger if exists task_experiment_event on public.experiments;
create trigger task_experiment_event after insert or update on public.experiments
for each row execute function public.task_experiment_event();

create or replace function public.task_claim_events() returns setof public.agent_task_events
language plpgsql set search_path = public as $$
begin
  -- Recovery: the task remains independent of any expired Eve session/workflow.
  update agent_tasks set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
    execution_key = null, lease_until = null, generation = generation + 1,
    reason = 'Execution interrupted; recovering from checkpoint', updated_at = now()
    where status = 'running' and lease_until < now();
  update agent_tasks set status = 'failed', reason = 'Task deadline reached', generation = generation + 1,
    execution_key = null, lease_until = null, updated_at = now()
    where status in ('queued','running','waiting') and deadline_at <= now();
  -- A lost dispatch, expired session, or an event delivered while paused must not strand a task.
  insert into agent_task_events(task_id,event_key,kind)
    select id, 'wake:' || id || ':' || generation || ':' || floor(extract(epoch from now()) / 120), 'task.wake'
    from agent_tasks t where t.status = 'queued'
      and not exists(select 1 from agent_task_events e where e.task_id=t.id and e.delivered_at is null)
    on conflict(event_key) do nothing;
  return query
    with picked as (
      select e.id from agent_task_events e join agent_tasks t on t.id=e.task_id
      where e.delivered_at is null and e.available_at <= now()
        and (e.lease_until is null or e.lease_until < now()) and t.status='queued'
      order by e.created_at for update of e skip locked limit 10
    ) update agent_task_events e set lease_until=now()+interval '2 minutes',
      delivery_token=gen_random_uuid(), attempts=e.attempts+1
      from picked where e.id=picked.id returning e.*;
end $$;

create or replace function public.task_claim(p_task uuid, p_student text, p_generation integer, p_execution text, p_session text)
returns public.agent_tasks language plpgsql set search_path = public as $$
declare t agent_tasks;
begin
  select * into t from agent_tasks where id=p_task and student_id=p_student for update;
  if not found or t.generation<>p_generation or t.deadline_at<=now() then return null; end if;
  if t.status='running' and t.execution_key=p_execution then return t; end if;
  if t.status<>'queued' then return null; end if;
  if t.attempts>=t.max_attempts then
    update agent_tasks set status='failed',reason='Retry limit reached' where id=t.id;
    return null;
  end if;
  update agent_tasks set status='running', execution_key=p_execution, session_id=p_session,
    attempts=attempts+1, lease_until=now()+interval '30 minutes', updated_at=now(), reason=null
    where id=t.id returning * into t;
  return t;
end $$;

create or replace function public.task_checkpoint(p_task uuid, p_execution text, p_phase text, p_checkpoint jsonb,
  p_status text default 'running', p_reason text default null, p_result jsonb default null)
returns public.agent_tasks language plpgsql set search_path = public as $$
declare t agent_tasks;
begin
  select * into t from agent_tasks where id=p_task for update;
  if t.status<>'running' or t.execution_key is distinct from p_execution or t.lease_until<=now() then
    raise exception 'Task execution is no longer active';
  end if;
  update agent_tasks set phase=p_phase, checkpoint=p_checkpoint, status=p_status, reason=p_reason,
    result=coalesce(p_result,result), attempts=case when phase<>p_phase then 0 else attempts end,
    execution_key=case when p_status='running' then p_execution else null end,
    lease_until=case when p_status='running' then now()+interval '30 minutes' else null end, updated_at=now()
    where id=p_task returning * into t;
  -- Close the race where the game finished before the workflow parked.
  if p_status='waiting' and exists(select 1 from experiments where task_id=p_task and summary is not null and status in ('completed','failed','canceled','cancelled')) then
    update agent_tasks set status='queued' where id=p_task returning * into t;
    perform task_enqueue(p_task,'ready:' || p_task || ':' || t.generation,'game.finished');
  end if;
  return t;
end $$;

create or replace function public.task_control(p_task uuid, p_student text, p_action text, p_note text default '')
returns public.agent_tasks language plpgsql set search_path = public as $$
declare t agent_tasks;
begin
  select * into t from agent_tasks where id=p_task and student_id=p_student for update;
  if not found then raise exception 'Task not found'; end if;
  if t.status in ('completed','canceled','failed') then raise exception 'Task is already finished'; end if;
  if p_action not in ('pause','resume','cancel') then raise exception 'Unknown task action'; end if;
  if p_action='pause' and t.status='paused' then return t; end if;
  if p_action='resume' and t.status not in ('paused','needs_input') then raise exception 'Task is not paused'; end if;
  if p_action='resume' and t.deadline_at<=now() then raise exception 'Task deadline has passed'; end if;
  update agent_tasks set status=case p_action when 'pause' then 'paused' when 'cancel' then 'canceled' else 'queued' end,
    generation=generation+1, execution_key=null, lease_until=null, updated_at=now(),
    checkpoint=case when p_note<>'' then jsonb_set(checkpoint,'{student_note}',to_jsonb(p_note)) else checkpoint end,
    reason=case p_action when 'pause' then 'Paused by student' when 'cancel' then 'Canceled by student' else 'Resuming from checkpoint' end
    where id=p_task returning * into t;
  if p_action='resume' then perform task_enqueue(t.id,'resume:' || t.id || ':' || t.generation,'task.resumed'); end if;
  return t;
end $$;

-- Called before every root/worker model call. Reservations survive retries and session rollover.
create or replace function public.task_reserve_call(p_task uuid, p_generation integer, p_call text) returns boolean
language plpgsql set search_path = public as $$
declare t agent_tasks;
begin
  select * into t from agent_tasks where id=p_task for update;
  if not found or t.generation<>p_generation or t.status not in ('queued','running') or t.deadline_at<=now() then return false; end if;
  if exists(select 1 from agent_task_usage where task_id=p_task and call_key=p_call) then return true; end if;
  if t.model_calls>=t.max_model_calls or t.reported_cost_usd>=t.max_cost_usd then
    update agent_tasks set status='needs_input',reason='Task model budget reached',generation=generation+1,
      execution_key=null,lease_until=null,updated_at=now() where id=p_task;
    return false;
  end if;
  insert into agent_task_usage(task_id,call_key) values(p_task,p_call);
  update agent_tasks set model_calls=model_calls+1,updated_at=now() where id=p_task;
  return true;
end $$;
create or replace function public.task_record_usage(p_task uuid,p_call text,p_cost numeric) returns void
language plpgsql set search_path = public as $$
begin
  update agent_task_usage set settled=true,cost_usd=p_cost where task_id=p_task and call_key=p_call and not settled;
  if found then update agent_tasks set reported_cost_usd=reported_cost_usd+coalesce(p_cost,0),
    cost_reports=cost_reports+case when p_cost is null then 0 else 1 end where id=p_task; end if;
end $$;

-- The policy insertion and task checkpoint are one transaction. A stale proposal never replaces a newer revision.
create or replace function public.task_save_policy(p_task uuid,p_execution text,p_revision jsonb,p_summary text)
returns uuid language plpgsql set search_path = public as $$
declare t agent_tasks; latest_id uuid; version_id uuid;
begin
  select * into t from agent_tasks where id=p_task for update;
  if t.status<>'running' or t.execution_key is distinct from p_execution or t.lease_until<=now() then raise exception 'Task stopped'; end if;
  if t.checkpoint ? 'version_id' then return (t.checkpoint->>'version_id')::uuid; end if;
  perform 1 from students where subject_id=t.student_id for update;
  select id into latest_id from policy_versions where student_id=t.student_id order by revision_number desc limit 1;
  if latest_id is distinct from t.base_version_id then raise exception 'Policy changed since this task started; create a task against the latest revision'; end if;
  if exists(select 1 from workspace_files where student_id=t.student_id and path='draft/hero.bas') then raise exception 'An unsaved policy draft needs your attention first'; end if;
  insert into policy_versions(student_id,revision_number,revision_id,parent_revision_id,summary,source,ir,receipts,evidence)
    values(t.student_id,(p_revision->'ir'->'update'->>'revision')::integer,p_revision->>'revisionId',
      p_revision->'ir'->'update'->>'parent',p_summary,p_revision->>'source',p_revision->'ir',p_revision->'receipts',jsonb_build_array('task:' || t.id))
    returning id into version_id;
  update agent_tasks set checkpoint=checkpoint || jsonb_build_object('version_id',version_id),phase='upload',attempts=0,updated_at=now() where id=p_task;
  return version_id;
end $$;

-- No RPC is callable by browser Supabase roles.
revoke all on function public.task_enqueue(uuid,text,text,jsonb), public.task_experiment_event(),
 public.task_claim_events(), public.task_claim(uuid,text,integer,text,text),
 public.task_checkpoint(uuid,text,text,jsonb,text,text,jsonb), public.task_control(uuid,text,text,text),
 public.task_reserve_call(uuid,integer,text), public.task_record_usage(uuid,text,numeric),
 public.task_save_policy(uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.task_enqueue(uuid,text,text,jsonb), public.task_experiment_event(),
 public.task_claim_events(), public.task_claim(uuid,text,integer,text,text),
 public.task_checkpoint(uuid,text,text,jsonb,text,text,jsonb), public.task_control(uuid,text,text,text),
 public.task_reserve_call(uuid,integer,text), public.task_record_usage(uuid,text,numeric),
 public.task_save_policy(uuid,text,jsonb,text) to service_role;

create or replace function public.task_reserve_game(p_task uuid,p_execution text) returns void
language plpgsql set search_path = public as $$
declare t agent_tasks;
begin
  select * into t from agent_tasks where id=p_task for update;
  if t.status<>'running' or t.execution_key is distinct from p_execution or t.lease_until<=now() or t.deadline_at<=now() then raise exception 'Task stopped'; end if;
  if t.checkpoint ? 'game_reserved' then return; end if;
  if t.games_requested>=t.max_games then raise exception 'Hosted game budget reached'; end if;
  update agent_tasks set games_requested=games_requested+1,checkpoint=checkpoint || '{"game_reserved":true}'::jsonb where id=p_task;
end $$;
revoke all on function public.task_reserve_game(uuid,text) from public,anon,authenticated;
grant execute on function public.task_reserve_game(uuid,text) to service_role;

create index if not exists agent_tasks_status_updated on public.agent_tasks(status,updated_at);
create index if not exists agent_task_events_task on public.agent_task_events(task_id);
alter table public.agent_tasks add column if not exists next_check_at timestamptz not null default now();
create index if not exists agent_tasks_next_check on public.agent_tasks(next_check_at) where status='waiting';

create or replace function public.task_worker(p_task uuid,p_execution text,p_key text,p_role text,
  p_finish boolean default false,p_output jsonb default null,p_failed boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare t agent_tasks; w agent_task_workers;
begin
  select * into t from agent_tasks where id=p_task for update;
  if t.status<>'running' or t.execution_key is distinct from p_execution or t.lease_until<=now() then raise exception 'Task execution is no longer active'; end if;
  select * into w from agent_task_workers where task_id=p_task and worker_key=p_key;
  if not p_finish and w.status='completed' then return w.output; end if;
  insert into agent_task_workers(task_id,worker_key,role,status,output)
    values(p_task,p_key,p_role,case when p_failed then 'failed' when p_finish then 'completed' else 'running' end,p_output)
    on conflict(task_id,worker_key) do update set role=excluded.role,status=excluded.status,output=excluded.output,updated_at=now();
  return p_output;
end $$;
revoke all on function public.task_worker(uuid,text,text,text,boolean,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.task_worker(uuid,text,text,text,boolean,jsonb,boolean) to service_role;
