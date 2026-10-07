-- Shared model pacing is separate from the student's research budget.
create table task_model_pacing(model text primary key, next_at timestamptz not null);
create table task_model_slots(task_id uuid references agent_tasks(id) on delete cascade,
 call_key text not null, granted_at timestamptz not null default now(), primary key(task_id,call_key));
alter table task_model_pacing enable row level security;
alter table task_model_slots enable row level security;
grant all on task_model_pacing,task_model_slots to service_role;

-- -1 stops stale work, 0 grants a call, positive milliseconds asks it to wait.
create function task_model_slot(p_task uuid,p_student text,p_generation integer,p_call text)
returns integer language plpgsql set search_path=public as $$
declare t agent_tasks; ready timestamptz; selected text;
begin
 select * into t from agent_tasks where id=p_task and student_id=p_student for update;
 if not found or t.generation<>p_generation or t.status not in ('queued','running') or t.deadline_at<=now() then return -1;end if;
 selected:=t.model_selection->>'model';
 if selected<>'gpt-6-astra' or selected is null then return 0;end if;
 if exists(select 1 from task_model_slots where task_id=p_task and call_key=p_call) then return 0;end if;
 insert into task_model_pacing values(selected,now()) on conflict do nothing;
 select next_at into ready from task_model_pacing where model=selected for update;
 if ready>now() then return ceil(extract(epoch from ready-now())*1000)::integer;end if;
 -- Three large-context calls/minute leaves headroom under the shared 1M TPM
 -- limit for other users and interactive requests. No session-token reduction.
 update task_model_pacing set next_at=now()+interval '20 seconds' where model=selected;
 insert into task_model_slots(task_id,call_key) values(p_task,p_call);
 return 0;
end $$;

create function task_provider_cooldown(p_task uuid,p_execution text,p_message text)
returns boolean language plpgsql set search_path=public as $$
declare t agent_tasks; retries integer; ready timestamptz;
begin
 select * into t from agent_tasks where id=p_task for update;
 if not found or t.status<>'running' or t.execution_key is distinct from p_execution or t.lease_until<=now() then return false;end if;
 retries:=coalesce((t.checkpoint->>'provider_retries')::integer,0)+1;
 ready:=now()+make_interval(secs=>least(300,60*retries));
 update agent_tasks set status='waiting',execution_key=null,lease_until=null,generation=generation+1,
  attempts=greatest(0,attempts-1),next_check_at=ready,updated_at=now(),
  reason='Provider rate limit; resuming automatically',
  checkpoint=checkpoint||jsonb_build_object('provider_retry_at',ready,'provider_retries',retries,'provider_error',left(p_message,1000)) where id=p_task;
 return true;
end $$;

alter function task_claim_events() rename to task_claim_events_before_provider;
create function task_claim_events() returns setof agent_task_events language plpgsql set search_path=public as $$
begin
 update agent_tasks set status='queued',reason='Provider cooldown finished; resuming research',
  checkpoint=checkpoint-'provider_retry_at',updated_at=now()
 where status='waiting' and checkpoint ? 'provider_retry_at'
  and (checkpoint->>'provider_retry_at')::timestamptz<=now() and deadline_at>now();
 delete from task_model_slots where granted_at<now()-interval '7 days';
 return query select * from task_claim_events_before_provider();
end $$;
revoke all on function task_model_slot(uuid,text,integer,text),task_provider_cooldown(uuid,text,text),task_claim_events(),task_claim_events_before_provider() from public,anon,authenticated;
grant execute on function task_model_slot(uuid,text,integer,text),task_provider_cooldown(uuid,text,text),task_claim_events(),task_claim_events_before_provider() to service_role;
notify pgrst,'reload schema';
