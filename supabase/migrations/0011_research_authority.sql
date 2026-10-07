alter table research_cycles add column call_limit integer not null default 0 check(call_limit between 0 and 2000),
 add column game_limit integer not null default 0 check(game_limit between 0 and 20),
 add column calls_allocated integer not null default 0 check(calls_allocated>=0),
 add column games_allocated integer not null default 0 check(games_allocated>=0),
 add column expires_at timestamptz, add column autonomy boolean not null default false,
 add column cost_review_usd numeric not null default 5 check(cost_review_usd>0 and cost_review_usd<=100);
create table research_plans (
 id uuid primary key default gen_random_uuid(), student_id text not null references students(subject_id),
 cycle_id uuid not null references research_cycles(id), request_key text not null,
 objective text not null, criteria text not null, rationale text not null,
 evidence jsonb not null default '[]', priority integer not null default 0,
 max_calls integer not null default 24 check(max_calls between 6 and 100),
 status text not null default 'proposed' check(status in ('proposed','running','completed','failed','canceled')),
 task_id uuid references agent_tasks(id), created_at timestamptz not null default now(),
 unique(student_id,request_key)
);
alter table agent_tasks add column cycle_id uuid references research_cycles(id), add column plan_id uuid unique references research_plans(id);
alter table research_plans enable row level security;
revoke all on research_plans from anon,authenticated;
grant select,insert,update on research_plans to service_role;

create function research_grant(p_student text,p_cycle uuid,p_calls integer,p_games integer,p_expires timestamptz,p_autonomy boolean,p_cost numeric,p_key text)
returns void language plpgsql set search_path=public as $$
declare c research_cycles;
begin
 select * into c from research_cycles where id=p_cycle and student_id=p_student for update;
 if not found then raise exception 'Cycle not found'; end if;
 if exists(select 1 from research_events where student_id=p_student and event_key=p_key) then return; end if;
 if c.state='closed' then raise exception 'Cycle is closed';end if;
 if p_calls<c.calls_allocated or p_games<c.games_allocated then raise exception 'Allowance cannot be smaller than existing allocations'; end if;
 if p_expires<=now() or p_expires>now()+interval '30 days' then raise exception 'Choose an expiry within thirty days'; end if;
 update research_cycles set call_limit=p_calls,game_limit=p_games,expires_at=p_expires,autonomy=p_autonomy,
 cost_review_usd=p_cost,state='active',updated_at=now() where id=c.id;
 perform research_append(p_student,c.id,p_key,'human','allowance.granted',jsonb_build_object('modelCalls',p_calls,'hostedGames',p_games,'expiresAt',p_expires,'autonomy',p_autonomy,'costReviewUsd',p_cost,'scope','NeuralHub GoTA research; no league entry; no automatic promotion'));
end $$;
create function research_propose(p_student text,p_cycle uuid,p_key text,p_objective text,p_criteria text,p_rationale text,p_evidence jsonb,p_calls integer,p_priority integer,p_actor text)
returns uuid language plpgsql set search_path=public as $$
declare plan uuid;
begin
 perform 1 from research_cycles where id=p_cycle and student_id=p_student and state<>'closed';
 if not found then raise exception 'Open cycle not found';end if;
 insert into research_plans(student_id,cycle_id,request_key,objective,criteria,rationale,evidence,max_calls,priority)
 values(p_student,p_cycle,p_key,p_objective,p_criteria,p_rationale,p_evidence,p_calls,p_priority)
 on conflict(student_id,request_key) do nothing returning id into plan;
 if plan is null then select id into plan from research_plans where student_id=p_student and request_key=p_key;end if;
 perform research_append(p_student,p_cycle,'plan:'||plan,p_actor,'experiment.proposed',jsonb_build_object('planId',plan,'objective',p_objective,'rationale',p_rationale,'maxCalls',p_calls,'hostedGames',1),p_evidence);
 return plan;
end $$;

-- Reserve the complete operation allowance before exposing the task to the dispatcher.
create function research_start_plan(p_student text,p_plan uuid,p_manual boolean default false)
returns uuid language plpgsql set search_path=public as $$
declare p research_plans; c research_cycles; task uuid; base uuid; memory jsonb;
begin
 select * into p from research_plans where id=p_plan and student_id=p_student;
 if not found then raise exception 'Experiment plan not found';end if;
 select * into c from research_cycles where id=p.cycle_id and student_id=p_student for update;
 select * into p from research_plans where id=p_plan for update;
 if p.task_id is not null then return p.task_id;end if;
 if p.status<>'proposed' then raise exception 'Experiment is not proposed';end if;
 if c.state<>'active' or c.expires_at<=now() or c.expires_at is null then raise exception 'Research allowance is paused or expired';end if;
 if not p_manual and not c.autonomy then raise exception 'Between-visit work is disabled';end if;
 if c.calls_allocated+p.max_calls>c.call_limit or c.games_allocated+1>c.game_limit then raise exception 'Research allowance exhausted';end if;
 if exists(select 1 from agent_tasks where student_id=p_student and status not in ('completed','failed','canceled')) then raise exception 'Another experiment is still active';end if;
 if exists(select 1 from workspace_files where student_id=p_student and path='draft/hero.bas') then raise exception 'An unsaved policy draft needs attention';end if;
 if (select coalesce(sum(reported_cost_usd),0) from agent_tasks where cycle_id=c.id)>=c.cost_review_usd then raise exception 'Reported cost review threshold reached';end if;
 -- Stage 4 supplies the selected active baseline and contextual brief.
 base:=c.active_version_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'actor',e.actor,'kind',e.kind,'payload',e.payload,'evidence',e.evidence)),'[]') into memory
 from research_events e where e.student_id=p_student and e.cycle_id=c.id
 and e.kind in ('position','lesson','instruction','commitment','vocabulary','repair','salience','question')
 and not exists(select 1 from research_events s where s.supersedes=e.id)
 and (e.payload->>'expiresAt' is null or (e.payload->>'expiresAt')::timestamptz>now());
 insert into agent_tasks(student_id,request_key,objective,acceptance_criteria,base_version_id,max_model_calls,max_cost_usd,cycle_id,plan_id,deadline_at,checkpoint)
 values(p_student,'research:'||p.id,p.objective,p.criteria,base,p.max_calls,least(c.cost_review_usd,25),c.id,p.id,least(c.expires_at,now()+interval '7 days'),
 jsonb_build_object('research_brief',jsonb_build_object('cycleId',c.id,'question',c.question,'criteria',c.criteria,'baselineId',c.baseline_id,'rationale',p.rationale,'evidence',p.evidence,'memory',memory),
 'expected_latest_id',(select id from policy_versions where student_id=p_student order by revision_number desc limit 1))) returning id into task;
 update research_cycles set calls_allocated=calls_allocated+p.max_calls,games_allocated=games_allocated+1,updated_at=now() where id=c.id;
 update research_plans set status='running',task_id=task where id=p.id;
 perform research_append(p_student,c.id,'reservation:'||task,'preston','allowance.reserved',jsonb_build_object('planId',p.id,'taskId',task,'modelCalls',p.max_calls,'hostedGames',1,'rationale',p.rationale),p.evidence);
 perform task_enqueue(task,'created:'||task,'task.created');
 return task;
end $$;

-- Retain consumed calls/games; release only unused operation allocations. Late dollar reports remain attributable.
create function research_task_terminal() returns trigger language plpgsql set search_path=public as $$
begin
 if new.cycle_id is not null and new.status in ('completed','failed','canceled') and old.status not in ('completed','failed','canceled') then
  update research_cycles set calls_allocated=calls_allocated-(new.max_model_calls-new.model_calls),
   games_allocated=games_allocated-(new.max_games-new.games_requested),updated_at=now() where id=new.cycle_id;
  update research_plans set status=case new.status when 'completed' then 'completed' when 'canceled' then 'canceled' else 'failed' end where id=new.plan_id;
  perform research_append(new.student_id,new.cycle_id,'task-result:'||new.id,'system','experiment.finished',
   jsonb_build_object('taskId',new.id,'status',new.status,'result',new.result,'reason',new.reason,'modelCalls',new.model_calls,'hostedGames',new.games_requested,'reportedCostUsd',new.reported_cost_usd,'costReports',new.cost_reports,'candidateId',new.checkpoint->>'version_id'));
 end if;
 return new;
end $$;
create trigger research_task_terminal after update on agent_tasks for each row execute function research_task_terminal();
create function research_control(p_student text,p_cycle uuid,p_action text,p_key text) returns void language plpgsql set search_path=public as $$
begin
 if p_action not in ('pause','resume','close') then raise exception 'Unknown cycle action';end if;
 if exists(select 1 from research_events where student_id=p_student and event_key=p_key) then return;end if;
 update research_cycles set state=case p_action when 'pause' then 'paused' when 'close' then 'closed' else 'active' end,updated_at=now()
 where id=p_cycle and student_id=p_student and state<>'closed' and (p_action<>'resume' or expires_at>now());
 if not found then raise exception 'Cycle is closed, expired, or unavailable';end if;
 perform research_append(p_student,p_cycle,p_key,'human','cycle.'||p_action);
end $$;
revoke all on function research_grant(text,uuid,integer,integer,timestamptz,boolean,numeric,text),research_propose(text,uuid,text,text,text,text,jsonb,integer,integer,text),research_start_plan(text,uuid,boolean),research_task_terminal(),research_control(text,uuid,text,text) from public,anon,authenticated;
grant execute on function research_grant(text,uuid,integer,integer,timestamptz,boolean,numeric,text),research_propose(text,uuid,text,text,text,text,jsonb,integer,integer,text),research_start_plan(text,uuid,boolean),research_task_terminal(),research_control(text,uuid,text,text) to service_role;
