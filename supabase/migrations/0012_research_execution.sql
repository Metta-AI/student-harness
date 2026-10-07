-- Existing tasks remain compatible; research tasks additionally need live cycle authority.
alter function task_reserve_call(uuid,integer,text) rename to task_reserve_call_legacy;
create function task_reserve_call(p_task uuid,p_generation integer,p_call text) returns boolean language plpgsql set search_path=public as $$
declare t agent_tasks;
begin
 select * into t from agent_tasks where id=p_task for update;
 if t.cycle_id is not null and not exists(select 1 from research_cycles where id=t.cycle_id and state='active' and expires_at>now()) then
  if t.status in ('queued','running') then update agent_tasks set status='needs_input',reason='Cycle authority paused or expired',generation=generation+1,execution_key=null,lease_until=null where id=t.id;end if;
  return false;
 end if;
 return task_reserve_call_legacy(p_task,p_generation,p_call);
end $$;
alter function task_reserve_game(uuid,text) rename to task_reserve_game_legacy;
create function task_reserve_game(p_task uuid,p_execution text) returns void language plpgsql set search_path=public as $$
declare t agent_tasks;
begin
 select * into t from agent_tasks where id=p_task for update;
 if t.cycle_id is not null and not exists(select 1 from research_cycles where id=t.cycle_id and state='active' and expires_at>now()) then raise exception 'Cycle authority paused or expired';end if;
 perform task_reserve_game_legacy(p_task,p_execution);
end $$;

-- A research candidate may branch from the selected active policy. Global revision numbers stay unique.
create or replace function task_save_policy(p_task uuid,p_execution text,p_revision jsonb,p_summary text)
returns uuid language plpgsql set search_path=public as $$
declare t agent_tasks; latest_id uuid; latest_number integer; version_id uuid; base policy_versions;
begin
 select * into t from agent_tasks where id=p_task for update;
 if t.status<>'running' or t.execution_key is distinct from p_execution or t.lease_until<=now() then raise exception 'Task stopped';end if;
 if t.checkpoint ? 'version_id' then return (t.checkpoint->>'version_id')::uuid;end if;
 perform 1 from students where subject_id=t.student_id for update;
 select id,revision_number into latest_id,latest_number from policy_versions where student_id=t.student_id order by revision_number desc limit 1;
 select * into base from policy_versions where id=t.base_version_id and student_id=t.student_id;
 if t.cycle_id is null then
  if latest_id is distinct from t.base_version_id then raise exception 'Policy changed since this task started; create a task against the latest revision';end if;
 else
  if not exists(select 1 from research_cycles where id=t.cycle_id and state='active' and expires_at>now() and active_version_id=t.base_version_id) then raise exception 'Cycle authority paused or expired, or active policy changed';end if;
  if latest_id::text is distinct from t.checkpoint->>'expected_latest_id' then raise exception 'Policy changed since this experiment started';end if;
  if (p_revision->'ir'->'update'->>'revision')::integer<>latest_number+1 or p_revision->'ir'->'update'->>'parent' is distinct from base.revision_id then raise exception 'Candidate lineage is invalid';end if;
 end if;
 if exists(select 1 from workspace_files where student_id=t.student_id and path='draft/hero.bas') then raise exception 'An unsaved policy draft needs your attention first';end if;
 insert into policy_versions(student_id,revision_number,revision_id,parent_revision_id,summary,source,ir,receipts,evidence)
 values(t.student_id,(p_revision->'ir'->'update'->>'revision')::integer,p_revision->>'revisionId',p_revision->'ir'->'update'->>'parent',p_summary,p_revision->>'source',p_revision->'ir',p_revision->'receipts',jsonb_build_array('task:'||t.id)) returning id into version_id;
 update agent_tasks set checkpoint=checkpoint||jsonb_build_object('version_id',version_id),phase='upload',attempts=0,updated_at=now() where id=p_task;
 if t.cycle_id is not null then perform research_append(t.student_id,t.cycle_id,'candidate:'||t.id,'preston','candidate.saved',jsonb_build_object('taskId',t.id,'summary',p_summary),jsonb_build_array(jsonb_build_object('kind','revision','id',version_id)));end if;
 return version_id;
end $$;

create function research_resume_tasks() returns void language plpgsql set search_path=public as $$
begin
 update agent_tasks t set status='queued',reason='Cycle authority restored',generation=generation+1,attempts=0,updated_at=now()
 from research_cycles c where t.cycle_id=c.id and c.state='active' and c.expires_at>now() and c.autonomy
 and t.status='needs_input' and t.reason='Cycle authority paused or expired' and t.deadline_at>now();
end $$;
-- Effective memory need not fit in the recent-history window.
create view research_memory with (security_invoker=true) as
 select e.* from research_events e where e.kind in ('position','lesson','instruction','commitment','vocabulary','repair','salience','question')
 and not exists(select 1 from research_events s where s.supersedes=e.id)
 and (e.payload->>'expiresAt' is null or (e.payload->>'expiresAt')::timestamptz>now());
grant select on research_memory to service_role;
revoke all on research_memory from anon,authenticated;
-- A participant may correct its own record; disagreement cannot erase the other participant's position.
create function research_event_validate() returns trigger language plpgsql set search_path=public as $$
begin
 if new.supersedes is not null and not exists(select 1 from research_events where id=new.supersedes and actor=new.actor and student_id=new.student_id and cycle_id is not distinct from new.cycle_id) then raise exception 'Only the author may supersede a statement';end if;
 return new;
end $$;
create trigger research_event_validate before insert on research_events for each row execute function research_event_validate();
revoke all on function task_reserve_call(uuid,integer,text),task_reserve_game(uuid,text),research_resume_tasks(),research_event_validate() from public,anon,authenticated;
grant execute on function task_reserve_call(uuid,integer,text),task_reserve_game(uuid,text),research_resume_tasks(),research_event_validate() to service_role;
-- Legacy helpers are internal, not an alternate service entry point around cycle authority.
revoke execute on function task_reserve_call_legacy(uuid,integer,text),task_reserve_game_legacy(uuid,text) from service_role;
alter function task_reserve_call(uuid,integer,text) security definer;
alter function task_reserve_game(uuid,text) security definer;
