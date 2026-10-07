create table agent_task_history (
 id bigint generated always as identity primary key,
 task_id uuid not null references agent_tasks(id) on delete cascade,
 kind text not null,
 content jsonb not null,
 created_at timestamptz not null default now()
);
create index agent_task_history_task on agent_task_history(task_id,id);
alter table agent_task_history enable row level security;
revoke all on agent_task_history from anon,authenticated;
grant select,insert on agent_task_history to service_role;
grant usage,select on sequence agent_task_history_id_seq to service_role;
create function task_record_history() returns trigger language plpgsql set search_path=public as $$
begin
 if new.checkpoint->>'student_note' is distinct from old.checkpoint->>'student_note' and new.checkpoint->>'student_note' is not null then
  insert into agent_task_history(task_id,kind,content) values(new.id,'direction',jsonb_build_object('text',new.checkpoint->>'student_note'));
 end if;
 if new.checkpoint->'research_progress' is distinct from old.checkpoint->'research_progress' and new.checkpoint->'research_progress' is not null then
  insert into agent_task_history(task_id,kind,content) values(new.id,'progress',new.checkpoint->'research_progress');
 end if;
 if new.status is distinct from old.status or new.phase is distinct from old.phase or new.reason is distinct from old.reason then
  insert into agent_task_history(task_id,kind,content) values(new.id,'status',jsonb_build_object('status',new.status,'phase',new.phase,'reason',new.reason));
 end if;
 return new;
end $$;
create trigger task_history after update on agent_tasks for each row execute function task_record_history();
revoke all on function task_record_history() from public,anon,authenticated;
notify pgrst,'reload schema';
