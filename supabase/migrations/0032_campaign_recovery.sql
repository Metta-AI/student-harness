-- Serialize observation with fixture reservation, including competing research sessions.
create function campaign_evidence_lock() returns trigger language plpgsql as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.student_id||':'||new.league_id,0));
 if tg_table_name='research_fixtures' then
  if exists(select 1 from research_exclusions where student_id=new.student_id and league_id=new.league_id and (episode_id=new.episode_id or seed_key=new.seed_key)) then raise exception 'Fixture was already observed';end if;
 else
  if exists(select 1 from research_fixtures f join research_studies s on s.id=f.study_id where f.student_id=new.student_id and f.league_id=new.league_id and (f.episode_id=new.episode_id or f.seed_key=new.seed_key) and s.state in ('running','auditing')) then raise exception 'Episode is reserved for a frozen study';end if;
 end if;
 return new;
end $$;
create trigger fixture_observation_lock before insert on research_fixtures for each row execute function campaign_evidence_lock();
create trigger exclusion_observation_lock before insert or update on research_exclusions for each row execute function campaign_evidence_lock();

-- Root session state follows its campaign in the same transaction as pause/save.
create function campaign_session_sync() returns trigger language plpgsql as $$
begin
 update agent_tasks set status=case when new.state='active' then 'waiting' else new.state end,
  reason=new.checkpoint->>'message', checkpoint=jsonb_build_object('campaign_id',new.id,'research_progress',jsonb_build_object('summary',coalesce(new.checkpoint->>'message',new.phase)),'campaign_phase',new.phase,'cycle',new.cycle),
  result=new.checkpoint->'lastResult',next_check_at='2100-01-01',updated_at=now() where id=new.task_id;
 return new;
end $$;
create trigger campaign_session_sync after insert or update on research_campaigns for each row execute function campaign_session_sync();

create function campaign_control(p_id uuid,p_student text,p_action text,p_note text default '') returns void
 language plpgsql security definer set search_path=public as $$
declare c research_campaigns;
begin
 select * into c from research_campaigns where id=p_id and student_id=p_student for update;
 if not found then raise exception 'Campaign not found';end if;
 if c.state in ('canceled','completed') then raise exception 'Campaign has ended';end if;
 if p_action not in ('pause','resume','cancel','steer') then raise exception 'Invalid campaign action';end if;
 update research_campaigns set state=case p_action when 'pause' then 'paused' when 'resume' then 'active' when 'cancel' then 'canceled' else state end,
  checkpoint=checkpoint||case when p_note<>'' then jsonb_build_object('direction',p_note) else '{}'::jsonb end,
  lease_token=null,lease_until=null,next_at=now(),updated_at=now() where id=c.id;
end $$;
revoke all on function campaign_control(uuid,text,text,text) from public,anon,authenticated;
grant execute on function campaign_control(uuid,text,text,text) to service_role;

-- Completion is a durable wake-up, not a message in Preston's conversation.
create function campaign_child_wake() returns trigger language plpgsql as $$
declare cid uuid;
begin
 if new.status is not distinct from old.status or new.status not in ('completed','failed','needs_input','canceled') then return new;end if;
 if new.context->>'campaignId' is null then return new;end if;
 cid:=(new.context->>'campaignId')::uuid;
 insert into research_campaign_events(campaign_id,event_key,kind,payload) select id,'session:'||new.id||':'||new.status,'session.finished',jsonb_build_object('taskId',new.id,'status',new.status) from research_campaigns where id=cid and student_id=new.student_id on conflict do nothing;
 update research_campaigns set next_at=least(next_at,now()) where id=cid and student_id=new.student_id and state='active';
 return new;
end $$;
create trigger campaign_child_wake after update on agent_tasks for each row execute function campaign_child_wake();
