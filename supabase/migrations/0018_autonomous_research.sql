-- Standing workspace capacity and a durable, idempotent research inbox.
create table research_settings (
 student_id text primary key references students(subject_id), enabled boolean not null default true,
 call_limit integer not null default 120 check(call_limit between 0 and 2000),
 game_limit integer not null default 4 check(game_limit between 0 and 100),
 calls_allocated integer not null default 0 check(calls_allocated>=0),
 games_allocated integer not null default 0 check(games_allocated>=0),
 expires_at timestamptz not null default now()+interval '7 days',
 interests text not null default '', active_version_id uuid references policy_versions(id),
 updated_at timestamptz not null default now()
);
alter table research_cycles add column autonomous boolean not null default false;
alter table research_evaluations add column actor text not null default 'human' check(actor in ('human','preston'));
create table research_wakes (
 id uuid primary key default gen_random_uuid(), student_id text not null references students(subject_id),
 event_key text not null, reason text not null, status text not null default 'queued' check(status in ('queued','running','completed','failed')),
 token uuid, lease_until timestamptz, attempts integer not null default 0, calls integer not null default 0,
 result jsonb, error text, created_at timestamptz not null default now(), unique(student_id,event_key)
);
create table research_director_calls (
 call_key text primary key, wake_id uuid not null references research_wakes(id), cost_usd numeric,
 created_at timestamptz not null default now()
);
alter table research_settings enable row level security;
alter table research_wakes enable row level security;
alter table research_director_calls enable row level security;
revoke all on research_settings,research_wakes,research_director_calls from public,anon,authenticated;
grant select,insert,update on research_settings,research_wakes,research_director_calls to service_role;

create function autoresearch_bootstrap(p_student text) returns research_settings language plpgsql set search_path=public as $$
declare s research_settings;
begin
 insert into research_settings(student_id,active_version_id)
 values(p_student,(select id from policy_versions where student_id=p_student order by revision_number desc limit 1)) on conflict do nothing;
 select * into s from research_settings where student_id=p_student;
 insert into research_wakes(student_id,event_key,reason) values(p_student,'initial','Explore the current policy and choose a useful first investigation') on conflict do nothing;
 return s;
end $$;

create function autoresearch_settings(p_student text,p_enabled boolean,p_calls integer,p_games integer,p_expires timestamptz,p_interests text)
returns research_settings language plpgsql set search_path=public as $$
declare s research_settings;
begin
 select * into s from research_settings where student_id=p_student for update;
 if not found then raise exception 'Research settings unavailable';end if;
 if p_calls<s.calls_allocated or p_games<s.games_allocated then raise exception 'Limits cannot be smaller than used or reserved capacity';end if;
 if p_expires<=now() or p_expires>now()+interval '30 days' then raise exception 'Choose an expiry within thirty days';end if;
 update research_settings set enabled=p_enabled,call_limit=p_calls,game_limit=p_games,expires_at=p_expires,interests=p_interests,updated_at=now() where student_id=p_student returning * into s;
 if p_enabled then insert into research_wakes(student_id,event_key,reason) values(p_student,'settings:'||gen_random_uuid(),'Research settings or interests changed') on conflict do nothing;end if;
 return s;
end $$;

create function autoresearch_claim_wakes() returns setof research_wakes language plpgsql set search_path=public as $$
begin
 -- Wake after a saved first policy, and after real experiment outcomes. No idle busywork.
 insert into research_wakes(student_id,event_key,reason)
 select s.student_id,'policy:'||v.id,'A policy revision was saved; consider whether it changes the research agenda'
 from research_settings s join lateral(select id from policy_versions where student_id=s.student_id order by revision_number desc limit 1) v on true
 where s.enabled and not exists(select 1 from agent_tasks where student_id=s.student_id and status not in ('completed','failed','canceled'))
 on conflict do nothing;
 insert into research_wakes(student_id,event_key,reason)
 select e.student_id,'result:'||e.id,'Experiment finished: '||e.payload::text from research_events e join research_settings s on s.student_id=e.student_id
 where e.kind='experiment.finished' and s.enabled and e.created_at>=s.updated_at-interval '7 days' on conflict do nothing;
 update research_wakes set status='failed',error='Research dispatch retry limit reached' where status='running' and lease_until<now() and attempts>=3;
 return query
 with eligible as (
  select w.id from research_wakes w join research_settings s on s.student_id=w.student_id
  where s.enabled and s.expires_at>now() and s.calls_allocated<s.call_limit
  and (w.status='queued' or (w.status='running' and w.lease_until<now() and w.attempts<3))
  and not exists(select 1 from research_wakes busy where busy.student_id=w.student_id and busy.status='running' and busy.lease_until>now())
  and w.id=(select oldest.id from research_wakes oldest where oldest.student_id=w.student_id and (oldest.status='queued' or (oldest.status='running' and oldest.lease_until<now() and oldest.attempts<3)) order by oldest.created_at,oldest.id limit 1)
  and not exists(select 1 from agent_tasks t where t.student_id=w.student_id and t.status not in ('completed','failed','canceled'))
  order by w.created_at limit 20 for update of w skip locked
 ) update research_wakes w set status='running',token=gen_random_uuid(),lease_until=now()+interval '10 minutes',attempts=attempts+1
 from eligible e where w.id=e.id returning w.*;
end $$;

create function autoresearch_reserve_call(p_wake uuid,p_token uuid,p_call text) returns boolean language plpgsql set search_path=public as $$
declare w research_wakes;s research_settings;
begin
 select * into w from research_wakes where id=p_wake for update;
 if not found or w.status<>'running' or w.token is distinct from p_token or w.lease_until<=now() then return false;end if;
 select * into s from research_settings where student_id=w.student_id for update;
 if not s.enabled or s.expires_at<=now() then return false;end if;
 if exists(select 1 from research_director_calls where call_key=p_call and wake_id=w.id) then return true;end if;
 if w.calls>=8 or s.calls_allocated>=s.call_limit then return false;end if;
 insert into research_director_calls(call_key,wake_id) values(p_call,w.id);
 update research_settings set calls_allocated=calls_allocated+1 where student_id=w.student_id;
 update research_wakes set calls=calls+1 where id=w.id;
 return true;
end $$;

-- Reserve the entire worker task before launch; release unused capacity when it settles.
alter function research_start_plan(text,uuid,boolean) rename to research_start_plan_cycle;
create function research_start_plan(p_student text,p_plan uuid,p_manual boolean default false) returns uuid language plpgsql security definer set search_path=public as $$
declare p research_plans;c research_cycles;s research_settings;t uuid;
begin
 select * into p from research_plans where id=p_plan and student_id=p_student;
 if not found then raise exception 'Experiment plan not found';end if;
 select * into c from research_cycles where id=p.cycle_id for update;
 if not c.autonomous then return research_start_plan_cycle(p_student,p_plan,p_manual);end if;
 select * into p from research_plans where id=p_plan for update;
 if p.task_id is not null then return p.task_id;end if;
 select * into s from research_settings where student_id=p_student for update;
 if not found or not s.enabled or s.expires_at<=now() then raise exception 'Workspace research allowance paused or expired';end if;
 if s.calls_allocated+p.max_calls>s.call_limit or s.games_allocated+1>s.game_limit then raise exception 'Workspace research allowance exhausted';end if;
 update research_cycles set call_limit=calls_allocated+p.max_calls,game_limit=games_allocated+1,expires_at=s.expires_at where id=c.id;
 t:=research_start_plan_cycle(p_student,p_plan,p_manual);
 update research_settings set calls_allocated=calls_allocated+p.max_calls,games_allocated=games_allocated+1 where student_id=p_student;
 return t;
end $$;
revoke all on function research_start_plan_cycle(text,uuid,boolean) from public,anon,authenticated,service_role;

create function autoresearch_terminal() returns trigger language plpgsql set search_path=public as $$
begin
 if new.status in ('completed','failed','canceled') and old.status not in ('completed','failed','canceled')
 and exists(select 1 from research_cycles where id=new.cycle_id and autonomous) then
  update research_settings set calls_allocated=calls_allocated-(new.max_model_calls-new.model_calls),games_allocated=games_allocated-(new.max_games-new.games_requested) where student_id=new.student_id;
 end if;
 return new;
end $$;
-- Run after the cycle-release trigger to retain a consistent cycle → settings lock order.
create trigger zz_autoresearch_terminal after update on agent_tasks for each row execute function autoresearch_terminal();

create function autoresearch_guard(p_task uuid) returns boolean language sql stable set search_path=public as $$
 select not exists(select 1 from agent_tasks t join research_cycles c on c.id=t.cycle_id where t.id=p_task and c.autonomous
 and not exists(select 1 from research_settings s where s.student_id=t.student_id and s.enabled and s.expires_at>now()));
$$;
alter function task_reserve_call(uuid,integer,text) rename to task_reserve_call_cycle;
create function task_reserve_call(p_task uuid,p_generation integer,p_call text) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not autoresearch_guard(p_task) then return false;end if;
 return task_reserve_call_cycle(p_task,p_generation,p_call);
end $$;
alter function task_reserve_game(uuid,text) rename to task_reserve_game_cycle;
create function task_reserve_game(p_task uuid,p_execution text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not autoresearch_guard(p_task) then raise exception 'Workspace research allowance paused or expired';end if;
 perform task_reserve_game_cycle(p_task,p_execution);
end $$;
revoke all on function task_reserve_call_cycle(uuid,integer,text),task_reserve_game_cycle(uuid,text) from public,anon,authenticated,service_role;

create function autoresearch_evaluate(p_student text,p_cycle uuid,p_candidate uuid,p_baseline_xp text,p_candidate_xp text,p_finding text,p_explanation text,p_key text)
returns uuid language plpgsql set search_path=public as $$
declare c research_cycles; evaluation uuid;
begin
 select * into c from research_cycles where id=p_cycle and student_id=p_student for update;
 if not found then raise exception 'Cycle not found';end if;
 select id into evaluation from research_evaluations where student_id=p_student and request_key=p_key and cycle_id=c.id;
 if evaluation is not null then return evaluation;end if;
 if p_candidate=c.active_version_id or not exists(select 1 from policy_versions where id=p_candidate and student_id=p_student) then raise exception 'Choose a different owned candidate';end if;
 if not exists(select 1 from experiments where student_id=p_student and policy_version_id=c.active_version_id and xp_request_id=p_baseline_xp and status='completed' and summary is not null)
 or not exists(select 1 from experiments where student_id=p_student and policy_version_id=p_candidate and xp_request_id=p_candidate_xp and status='completed' and summary is not null)
 then raise exception 'Review needs completed evidence for both exact policy versions';end if;
 insert into research_evaluations(student_id,cycle_id,baseline_id,candidate_id,baseline_xp,candidate_xp,finding,explanation,request_key,actor)
 values(p_student,c.id,c.active_version_id,p_candidate,p_baseline_xp,p_candidate_xp,p_finding,p_explanation,p_key,'preston')
 on conflict(student_id,request_key) do nothing returning id into evaluation;
 if evaluation is null then select id into evaluation from research_evaluations where student_id=p_student and request_key=p_key;end if;
 perform research_append(p_student,c.id,'evaluation:'||evaluation,'preston','evaluation.recorded',
 jsonb_build_object('evaluationId',evaluation,'candidateId',p_candidate,'finding',p_finding,'text',p_explanation,'scope','Preston-reviewed behavior; competitive improvement unverified'),
 jsonb_build_array(jsonb_build_object('kind','experiment','id',p_baseline_xp),jsonb_build_object('kind','experiment','id',p_candidate_xp)));
 return evaluation;
end $$;

create function autoresearch_select_policy(p_student text,p_cycle uuid,p_version uuid,p_evaluation uuid,p_reason text,p_key text)
returns void language plpgsql set search_path=public as $$
declare c research_cycles; rollback boolean;
begin
 select * into c from research_cycles where id=p_cycle and student_id=p_student for update;
 if not found or not c.autonomous or c.state<>'active' then raise exception 'Active autonomous cycle not found';end if;
 if exists(select 1 from research_events where student_id=p_student and event_key=p_key) then return;end if;
 if exists(select 1 from agent_tasks where cycle_id=c.id and status not in ('completed','failed','canceled')) then raise exception 'Finish or cancel the active experiment before selecting a policy';end if;
 rollback:=p_evaluation is null and (p_version=c.baseline_id or exists(select 1 from research_events where cycle_id=c.id and kind='policy.selected' and payload->>'versionId'=p_version::text));
 if not rollback and not exists(select 1 from research_evaluations where id=p_evaluation and student_id=p_student and cycle_id=c.id and candidate_id=p_version and baseline_id=c.active_version_id and finding='supported') then raise exception 'A supported review against the current active version is required';end if;
 if not exists(select 1 from policy_versions where id=p_version and student_id=p_student) then raise exception 'Policy not found';end if;
 if exists(select 1 from workspace_files where student_id=p_student and path='draft/hero.bas') then raise exception 'Preserving an unsaved human draft';end if;
 update research_settings set active_version_id=p_version where student_id=p_student and enabled and expires_at>now() and active_version_id=c.active_version_id;
 if not found then raise exception 'Active policy changed or research paused';end if;
 update research_cycles set active_version_id=p_version,updated_at=now() where id=c.id;
 perform research_append(p_student,c.id,p_key,'preston','policy.selected',jsonb_build_object('versionId',p_version,'previousVersionId',c.active_version_id,'evaluationId',p_evaluation,'rollback',rollback,'text',p_reason),jsonb_build_array(jsonb_build_object('kind','revision','id',p_version)));
end $$;

-- Apply a director decision once, with its wake lease, in one transaction.
create function autoresearch_apply(p_student text,p_wake uuid,p_token uuid,p_decision jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare w research_wakes;s research_settings;c research_cycles;a jsonb;e uuid;plan uuid;base uuid;idx integer:=0;
begin
 select * into w from research_wakes where id=p_wake and student_id=p_student for update;
 if not found then raise exception 'Research wake not found';end if;
 if w.status='completed' then return w.result;end if;
 if w.status<>'running' or w.token is distinct from p_token or w.lease_until<=now() then raise exception 'Research wake lease ended';end if;
 select * into s from research_settings where student_id=p_student;
 if not s.enabled or s.expires_at<=now() then raise exception 'Research is paused or expired';end if;
 if jsonb_array_length(p_decision->'actions')>4 then raise exception 'Too many research actions';end if;
 for a in select * from jsonb_array_elements(p_decision->'actions') loop
  idx:=idx+1;
  if a->>'action'='investigate' then
   base:=coalesce(s.active_version_id,(select id from policy_versions where student_id=p_student order by revision_number desc limit 1));
   if base is null then raise exception 'Save a starter policy before investigating';end if;
   if exists(select 1 from research_cycles where student_id=p_student and autonomous and state in ('active','paused') and question=a->>'question') then continue;end if;
   insert into preston_partnerships(student_id) values(p_student) on conflict do nothing;
   insert into research_cycles(student_id,request_key,question,criteria,baseline_id,active_version_id,state,autonomy,autonomous,expires_at)
   values(p_student,'wake:'||w.id||':'||idx,a->>'question',a->>'criteria',base,base,'active',true,true,s.expires_at) returning * into c;
   update research_settings set active_version_id=base where student_id=p_student and active_version_id is null;
   perform research_append(p_student,c.id,'cycle:'||c.id,'preston','cycle.created',jsonb_build_object('question',c.question,'criteria',c.criteria),jsonb_build_array(jsonb_build_object('kind','revision','id',base)));
   plan:=research_propose(p_student,c.id,'wake-plan:'||w.id||':'||idx,a->>'objective',a->>'criteria',a->>'rationale',a->'evidence',coalesce((a->>'maxCalls')::integer,24),coalesce((a->>'priority')::integer,50),'preston',coalesce(a->>'mode','candidate'));
  elsif a->>'action'='experiment' then
   select * into c from research_cycles where id=(a->>'cycleId')::uuid and student_id=p_student and autonomous and state='active';
   if not found then raise exception 'Active autonomous cycle not found';end if;
   if exists(select 1 from research_plans where cycle_id=c.id and status in ('proposed','running') and objective=a->>'objective') then continue;end if;
   plan:=research_propose(p_student,c.id,'wake-plan:'||w.id||':'||idx,a->>'objective',a->>'criteria',a->>'rationale',a->'evidence',coalesce((a->>'maxCalls')::integer,24),coalesce((a->>'priority')::integer,50),'preston',coalesce(a->>'mode','candidate'));
  elsif a->>'action'='evaluate' then
   perform 1 from research_cycles where id=(a->>'cycleId')::uuid and student_id=p_student and autonomous and state='active';
   if not found then raise exception 'Active autonomous cycle not found';end if;
   e:=autoresearch_evaluate(p_student,(a->>'cycleId')::uuid,(a->>'candidateId')::uuid,a->>'baselineXp',a->>'candidateXp',a->>'finding',a->>'explanation','wake-eval:'||w.id||':'||idx);
   if coalesce((a->>'selectCandidate')::boolean,false) then
    perform autoresearch_select_policy(p_student,(a->>'cycleId')::uuid,(a->>'candidateId')::uuid,e,a->>'explanation','wake-select:'||w.id||':'||idx);
   end if;
  elsif a->>'action'='rollback' then
   perform autoresearch_select_policy(p_student,(a->>'cycleId')::uuid,(a->>'versionId')::uuid,null,a->>'reason','wake-select:'||w.id||':'||idx);
  elsif a->>'action'='conclude' then
   update research_cycles set state='closed',updated_at=now() where id=(a->>'cycleId')::uuid and student_id=p_student and autonomous and state='active';
   if not found then raise exception 'Active autonomous cycle not found';end if;
   perform research_append(p_student,(a->>'cycleId')::uuid,'wake-conclude:'||w.id||':'||idx,'preston','cycle.concluded',jsonb_build_object('text',a->>'reason'));
  elsif a->>'action'<>'idle' then raise exception 'Unknown research decision';
  end if;
 end loop;
 if length(coalesce(p_decision->>'briefing',''))>0 then
  perform research_append(p_student,null,'briefing:'||w.id,'preston','research.briefing',jsonb_build_object('text',p_decision->>'briefing','category',p_decision->>'category'),coalesce(p_decision->'evidence','[]'));
 end if;
 update research_wakes set status='completed',result=p_decision,lease_until=null where id=w.id;
 return p_decision;
end $$;

-- Restrict new entry points to authenticated server code; callers derive the student identity.
revoke all on function autoresearch_bootstrap(text),autoresearch_settings(text,boolean,integer,integer,timestamptz,text),autoresearch_claim_wakes(),autoresearch_reserve_call(uuid,uuid,text),autoresearch_terminal(),autoresearch_guard(uuid),autoresearch_evaluate(text,uuid,uuid,text,text,text,text,text),autoresearch_select_policy(text,uuid,uuid,uuid,text,text),autoresearch_apply(text,uuid,uuid,jsonb),research_start_plan(text,uuid,boolean),task_reserve_call(uuid,integer,text),task_reserve_game(uuid,text) from public,anon,authenticated;
grant execute on function autoresearch_bootstrap(text),autoresearch_settings(text,boolean,integer,integer,timestamptz,text),autoresearch_claim_wakes(),autoresearch_reserve_call(uuid,uuid,text),autoresearch_guard(uuid),autoresearch_evaluate(text,uuid,uuid,text,text,text,text,text),autoresearch_select_policy(text,uuid,uuid,uuid,text,text),autoresearch_apply(text,uuid,uuid,jsonb),research_start_plan(text,uuid,boolean),task_reserve_call(uuid,integer,text),task_reserve_game(uuid,text) to service_role;
