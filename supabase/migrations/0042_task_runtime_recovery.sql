-- A runtime may terminate outside run_task, or its failure callback may be lost
-- during a database outage. Reconcile only a conclusively failed current root.
create function task_runtime_failed(p_session text,p_message text,p_attention boolean)
returns boolean language plpgsql set search_path=public as $$
declare t agent_tasks; retries integer; ready timestamptz; next_status text;
begin
 select * into t from agent_tasks where session_id=p_session and status in ('queued','running') for update;
 if not found or t.checkpoint->>'runtime_failed_session'=p_session then return false;end if;
 retries:=coalesce((t.checkpoint->>'runtime_retries')::integer,0)+1;
 ready:=now()+make_interval(secs=>least(300,30*retries));
 next_status:=case when t.deadline_at<=now() then 'failed' when p_attention or retries>=5 then 'needs_input' else 'waiting' end;
 update agent_tasks set status=next_status,generation=generation+1,execution_key=null,lease_until=null,
  attempts=case when t.status='running' then greatest(0,attempts-1) else attempts end,
  next_check_at=ready,updated_at=now(),
  reason=case when next_status='waiting' then 'Execution interrupted; retrying automatically from saved work'
   when next_status='failed' then 'Task deadline reached'
   else 'Execution could not recover automatically. Review the error and resume.' end,
  checkpoint=checkpoint||jsonb_build_object('runtime_retries',retries,'runtime_error',left(p_message,1000),'runtime_failed_session',p_session)
   ||case when next_status='waiting' then jsonb_build_object('provider_retry_at',ready) else '{}'::jsonb end
 where id=t.id;
 update agent_task_workers set status='failed',updated_at=now()
 where task_id=t.id and status='running';
 return true;
end $$;
revoke all on function task_runtime_failed(text,text,boolean) from public,anon,authenticated;
grant execute on function task_runtime_failed(text,text,boolean) to service_role;
notify pgrst,'reload schema';
