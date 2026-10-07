-- Model selection can fail before a usage reservation exists. Keep every root
-- execution address independently so restarting never hides its transcript.
create table agent_task_executions (
 task_id uuid not null references agent_tasks(id) on delete cascade,
 session_id text not null,
 generation integer not null,
 model_selection jsonb,
 created_at timestamptz not null default now(),
 primary key(task_id,session_id)
);
alter table agent_task_executions enable row level security;
revoke all on agent_task_executions from public,anon,authenticated;
grant select,insert on agent_task_executions to service_role;
insert into agent_task_executions(task_id,session_id,generation,model_selection)
 select id,session_id,generation,model_selection from agent_tasks where session_id is not null;
create function task_record_execution() returns trigger language plpgsql set search_path=public as $$
begin
 if new.session_id is not null then
  insert into agent_task_executions(task_id,session_id,generation,model_selection)
   values(new.id,new.session_id,new.generation,new.model_selection) on conflict do nothing;
 end if;
 return new;
end $$;
create trigger task_execution_history after insert or update of session_id on agent_tasks
 for each row execute function task_record_execution();
revoke all on function task_record_execution() from public,anon,authenticated;
notify pgrst,'reload schema';
