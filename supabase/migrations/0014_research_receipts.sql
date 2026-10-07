-- Model usage may arrive after the experiment receipt. Preserve that attribution too.
create function research_usage_receipt() returns trigger language plpgsql set search_path=public as $$
declare t agent_tasks;
begin
 if new.settled and not old.settled then
  select * into t from agent_tasks where id=new.task_id;
  if t.cycle_id is not null then
   perform research_append(t.student_id,t.cycle_id,'usage:'||t.id||':'||new.call_key,'system','cost.reported',
    jsonb_build_object('taskId',t.id,'callKey',new.call_key,'reportedCostUsd',new.cost_usd,'costKnown',new.cost_usd is not null));
  end if;
 end if;
 return new;
end $$;
create trigger research_usage_receipt after update on agent_task_usage for each row execute function research_usage_receipt();
create function research_cancel_plan(p_student text,p_plan uuid,p_key text) returns void language plpgsql set search_path=public as $$
declare p research_plans;
begin
 select * into p from research_plans where id=p_plan and student_id=p_student for update;
 if not found then raise exception 'Plan not found';end if;
 if p.task_id is not null then raise exception 'Open the task to stop an experiment that has already started';end if;
 update research_plans set status='canceled' where id=p.id;
 perform research_append(p_student,p.cycle_id,p_key,'human','experiment.declined',jsonb_build_object('planId',p.id,'objective',p.objective));
end $$;
revoke all on function research_usage_receipt(),research_cancel_plan(text,uuid,text) from public,anon,authenticated;
grant execute on function research_usage_receipt(),research_cancel_plan(text,uuid,text) to service_role;
