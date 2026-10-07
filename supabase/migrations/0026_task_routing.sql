-- Route a saved session atomically; only the current execution can acquire the policy writer.
create function task_route(p_task uuid,p_execution text,p_kind text,p_reason text) returns agent_tasks
language plpgsql set search_path=public as $$
declare t agent_tasks; base uuid; problem text;
begin
 select * into t from agent_tasks where id=p_task for update;
 if t.status<>'running' or t.execution_key is distinct from p_execution or t.lease_until<=now() or t.deadline_at<=now() then raise exception 'Task execution is no longer active';end if;
 if p_kind not in ('research','experiment') then raise exception 'Invalid work route';end if;
 if p_kind='experiment' then
  perform pg_advisory_xact_lock(hashtextextended(t.student_id,6812));
  select id into base from policy_versions where student_id=t.student_id order by revision_number desc limit 1;
  if base is null then problem:='Save a policy before running an experiment.';
  elsif exists(select 1 from workspace_files where student_id=t.student_id and path='draft/hero.bas') then problem:='An unsaved policy draft needs attention before the experiment can start.';
  elsif exists(select 1 from research_cycles where student_id=t.student_id and state='active') then problem:='An active research cycle already owns policy experiments. Add this direction to that cycle.';
  elsif exists(select 1 from agent_tasks where student_id=t.student_id and id<>t.id and kind='experiment' and status not in ('completed','failed','canceled')) then problem:='Another policy experiment is active. Resume this session after it finishes.';
  end if;
 end if;
 if problem is not null then
  return task_checkpoint(t.id,p_execution,t.phase,t.checkpoint,'needs_input',problem);
 end if;
 begin
  update agent_tasks set kind=p_kind,max_games=case when p_kind='experiment' then 1 else 0 end,
   base_version_id=coalesce(base,base_version_id),reason=p_reason,
   checkpoint=checkpoint||jsonb_build_object('route',jsonb_build_object('kind',p_kind,'reason',p_reason)),updated_at=now()
  where id=t.id returning * into t;
 exception when unique_violation then
  return task_checkpoint(t.id,p_execution,t.phase,t.checkpoint,'needs_input','Another policy experiment is active. Resume after it finishes.');
 end;
 return t;
end $$;
revoke all on function task_route(uuid,text,text,text) from public,anon,authenticated;
grant execute on function task_route(uuid,text,text,text) to service_role;
notify pgrst, 'reload schema';
