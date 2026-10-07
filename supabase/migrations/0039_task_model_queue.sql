create table task_model_waiters(task_id uuid references agent_tasks(id) on delete cascade,
 call_key text not null,generation integer not null,created_at timestamptz not null default clock_timestamp(),
 touched_at timestamptz not null default now(),primary key(task_id,call_key));
alter table task_model_waiters enable row level security;
grant all on task_model_waiters to service_role;

create or replace function task_model_slot(p_task uuid,p_student text,p_generation integer,p_call text)
returns integer language plpgsql set search_path=public as $$
declare t agent_tasks; ready timestamptz; selected text; first_task uuid; first_call text;
begin
 select * into t from agent_tasks where id=p_task and student_id=p_student for update;
 if not found or t.generation<>p_generation or t.status not in ('queued','running') or t.deadline_at<=now() then return -1;end if;
 selected:=t.model_selection->>'model';
 if selected<>'gpt-6-astra' or selected is null then return 0;end if;
 if exists(select 1 from task_model_slots where task_id=p_task and call_key=p_call) then return 0;end if;
 insert into task_model_pacing values(selected,now()) on conflict do nothing;
 select next_at into ready from task_model_pacing where model=selected for update;
 insert into task_model_waiters(task_id,call_key,generation) values(p_task,p_call,p_generation)
 on conflict(task_id,call_key) do update set touched_at=now();
 -- A crashed or fenced waiter cannot hold the queue. Active hooks poll within
 -- 20 seconds; two minutes allows transient transport failures without reranking.
 delete from task_model_waiters w where w.touched_at<now()-interval '2 minutes'
 or not exists(select 1 from agent_tasks a where a.id=w.task_id and a.generation=w.generation
  and a.status in ('queued','running') and a.deadline_at>now());
 if ready>now() then return ceil(extract(epoch from ready-now())*1000)::integer;end if;
 select w.task_id,w.call_key into first_task,first_call from task_model_waiters w
 join agent_tasks a on a.id=w.task_id where a.model_selection->>'model'=selected
 order by w.created_at,w.task_id,w.call_key limit 1;
 if first_task<>p_task or first_call<>p_call then return 1000;end if;
 update task_model_pacing set next_at=now()+interval '20 seconds' where model=selected;
 delete from task_model_waiters where task_id=p_task and call_key=p_call;
 insert into task_model_slots(task_id,call_key) values(p_task,p_call);
 return 0;
end $$;
notify pgrst,'reload schema';
