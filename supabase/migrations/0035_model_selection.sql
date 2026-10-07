alter table students add column chat_model text not null default 'claude-sonnet-5-5'
 check (chat_model in ('gpt-6-astra','gpt-6.1-sol','claude-sonnet-5-5','claude-opus-5-5'));
alter table students drop constraint students_reasoning_effort_check;
alter table students add constraint students_reasoning_effort_check check (reasoning_effort in ('low','medium','high','xhigh'));
alter table agent_tasks add column model_selection jsonb;
update agent_tasks t set model_selection=jsonb_build_object('model',s.chat_model,'effort',s.reasoning_effort) from students s where s.subject_id=t.student_id;
alter table agent_tasks alter column model_selection set not null;
create function task_select_model() returns trigger language plpgsql set search_path=public as $$
declare selected jsonb;
begin
 if new.context->>'campaignId' is not null then
  select t.model_selection into selected from research_campaigns c join agent_tasks t on t.id=c.task_id
   where c.id=(new.context->>'campaignId')::uuid and c.student_id=new.student_id;
  if selected is null then raise exception 'Campaign model selection unavailable'; end if;
 else
  select jsonb_build_object('model',chat_model,'effort',reasoning_effort) into selected from students where subject_id=new.student_id;
 end if;
 new.model_selection:=selected;
 return new;
end $$;
create trigger task_model_selection before insert on agent_tasks for each row execute function task_select_model();
create function task_preserve_model() returns trigger language plpgsql set search_path=public as $$
begin
 if new.model_selection is distinct from old.model_selection then raise exception 'Session model selection is immutable';end if;
 return new;
end $$;
create trigger task_model_immutable before update on agent_tasks for each row execute function task_preserve_model();
revoke all on function task_select_model(),task_preserve_model() from public,anon,authenticated;
notify pgrst,'reload schema';
