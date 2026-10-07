create table research_exclusions (
 student_id text not null references students(subject_id), league_id text not null,
 episode_id text not null, seed_key text, reason text not null, created_at timestamptz not null default now(),
 primary key(student_id,league_id,episode_id)
);
alter table research_exclusions enable row level security;
grant all on research_exclusions to service_role;

create function freeze_campaign_studies(p_campaign uuid,p_token uuid,p_studies jsonb) returns void
 language plpgsql security definer set search_path=public as $$
declare c research_campaigns; s jsonb; f jsonb; sid uuid; tid uuid;
begin
 select * into c from research_campaigns where id=p_campaign for update;
 if c.state<>'active' or c.lease_token is distinct from p_token or c.lease_until<=now() then raise exception 'Campaign is no longer active';end if;
 for s in select value from jsonb_array_elements(p_studies) loop
  if exists(select 1 from research_studies where campaign_id=c.id and cycle=c.cycle and cohort=s->>'cohort') then continue;end if;
  insert into agent_tasks(student_id,request_key,objective,acceptance_criteria,kind,max_games,max_model_calls,status,phase,context,deadline_at,next_check_at)
   values(c.student_id,'study:'||c.id||':'||c.cycle||':'||(s->>'cohort'),initcap(s->>'cohort')||' matched evaluation','Complete all frozen pairs, audit every game, report uncertainty.',
    'research',0,100,'waiting','evaluate',jsonb_build_object('campaignId',c.id,'role','evaluation','mode','study','leagueId',c.league_id,'title',initcap(s->>'cohort')||' · cycle '||c.cycle),'2100-01-01','2100-01-01') returning id into tid;
  insert into research_studies(student_id,campaign_id,task_id,cycle,cohort,protocol,protocol_hash,next_at)
   values(c.student_id,c.id,tid,c.cycle,s->>'cohort',s->'protocol',s->>'hash',case when s->>'cohort'='confirmation' then '2100-01-01'::timestamptz else now() end) returning id into sid;
  for f in select value from jsonb_array_elements(s->'fixtures') loop
   if exists(select 1 from research_exclusions where student_id=c.student_id and league_id=c.league_id and (episode_id=f->>'episodeId' or seed_key=f->>'seed')) then raise exception 'Fixture was already observed';end if;
   insert into research_fixtures(student_id,study_id,league_id,episode_id,seed_key,fixture) values(c.student_id,sid,c.league_id,f->>'episodeId',f->>'seed',f);
  end loop;
 end loop;
end $$;
revoke all on function freeze_campaign_studies(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function freeze_campaign_studies(uuid,uuid,jsonb) to service_role;

create function campaign_attempt_write(p_study uuid,p_token uuid,p_id uuid,p_patch jsonb) returns void
 language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from research_studies where id=p_study and lease_token=p_token and lease_until>now()) then raise exception 'Study lease expired';end if;
 update research_attempts set
  xp_id=coalesce(p_patch->>'xp_id',xp_id),episode_id=coalesce(p_patch->>'episode_id',episode_id),
  state=coalesce(p_patch->>'state',state),receipt=coalesce(p_patch->'receipt',receipt),result=coalesce(p_patch->'result',result),
  error=p_patch->>'error',next_at=coalesce((p_patch->>'next_at')::timestamptz,next_at),updated_at=now()
 where id=p_id and study_id=p_study;
 if not found then raise exception 'Attempt not found';end if;
end $$;
revoke all on function campaign_attempt_write(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function campaign_attempt_write(uuid,uuid,uuid,jsonb) to service_role;
