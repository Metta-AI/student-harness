-- A root model can fail before run_task claims its durable work. Do not leave
-- that work queued at an already-failed Eve address indefinitely.
create function task_dispatch_failed(p_task uuid,p_student text,p_generation integer,p_session text,p_message text,p_attention boolean)
returns boolean language plpgsql set search_path=public as $$
declare t agent_tasks; ready timestamptz; next_status text;
begin
 select * into t from agent_tasks where id=p_task and student_id=p_student for update;
 if not found or t.status<>'queued' or t.generation<>p_generation or t.session_id is distinct from p_session then return false;end if;
 ready:=now()+make_interval(secs=>least(300,60*(t.attempts+1)));
 next_status:=case when t.deadline_at<=now() then 'failed' when p_attention then 'needs_input'
  when t.attempts+1>=t.max_attempts then 'failed' else 'waiting' end;
 update agent_tasks set status=next_status,attempts=attempts+1,generation=generation+1,
  execution_key=null,lease_until=null,next_check_at=ready,reason=left(p_message,1000),updated_at=now(),
  checkpoint=checkpoint||jsonb_build_object('dispatch_error',left(p_message,1000))||
   case when next_status='waiting' then jsonb_build_object('provider_retry_at',ready) else '{}'::jsonb end
 where id=p_task;
 return true;
end $$;
revoke all on function task_dispatch_failed(uuid,text,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function task_dispatch_failed(uuid,text,integer,text,text,boolean) to service_role;
notify pgrst,'reload schema';
