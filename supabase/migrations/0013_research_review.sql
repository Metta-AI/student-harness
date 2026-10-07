create table research_evaluations (
 id uuid primary key default gen_random_uuid(), student_id text not null references students(subject_id), cycle_id uuid not null references research_cycles(id),
 baseline_id uuid not null references policy_versions(id), candidate_id uuid not null references policy_versions(id),
 baseline_xp text not null references experiments(xp_request_id), candidate_xp text not null references experiments(xp_request_id),
 finding text not null check(finding in ('supported','contradicted','inconclusive')), explanation text not null,
 created_at timestamptz not null default now(), request_key text not null, unique(student_id,request_key)
);
alter table research_evaluations enable row level security;
revoke all on research_evaluations from anon,authenticated;
grant select,insert on research_evaluations to service_role;
create trigger research_evaluation_immutable before update or delete on research_evaluations for each row execute function research_immutable();
create function research_evaluate(p_student text,p_cycle uuid,p_candidate uuid,p_baseline_xp text,p_candidate_xp text,p_finding text,p_explanation text,p_key text)
returns uuid language plpgsql set search_path=public as $$
declare c research_cycles; evaluation uuid;
begin
 select * into c from research_cycles where id=p_cycle and student_id=p_student for update;
 if not found then raise exception 'Cycle not found';end if;
 if p_candidate=c.active_version_id or not exists(select 1 from policy_versions where id=p_candidate and student_id=p_student) then raise exception 'Choose a different owned candidate';end if;
 if not exists(select 1 from experiments where student_id=p_student and policy_version_id=c.active_version_id and xp_request_id=p_baseline_xp and status='completed' and summary is not null)
 or not exists(select 1 from experiments where student_id=p_student and policy_version_id=p_candidate and xp_request_id=p_candidate_xp and status='completed' and summary is not null)
 then raise exception 'Review needs completed evidence for both exact policy versions';end if;
 insert into research_evaluations(student_id,cycle_id,baseline_id,candidate_id,baseline_xp,candidate_xp,finding,explanation,request_key)
 values(p_student,c.id,c.active_version_id,p_candidate,p_baseline_xp,p_candidate_xp,p_finding,p_explanation,p_key)
 on conflict(student_id,request_key) do nothing returning id into evaluation;
 if evaluation is null then select id into evaluation from research_evaluations where student_id=p_student and request_key=p_key;end if;
 perform research_append(p_student,c.id,'evaluation:'||evaluation,'human','evaluation.recorded',
 jsonb_build_object('evaluationId',evaluation,'candidateId',p_candidate,'finding',p_finding,'text',p_explanation,'scope','Human-reviewed behavior; competitive improvement unverified'),
 jsonb_build_array(jsonb_build_object('kind','experiment','id',p_baseline_xp),jsonb_build_object('kind','experiment','id',p_candidate_xp)));
 return evaluation;
end $$;
create function research_select_policy(p_student text,p_cycle uuid,p_version uuid,p_evaluation uuid,p_reason text,p_key text)
returns void language plpgsql set search_path=public as $$
declare c research_cycles; rollback boolean;
begin
 select * into c from research_cycles where id=p_cycle and student_id=p_student for update;
 if not found then raise exception 'Cycle not found';end if;
 if exists(select 1 from research_events where student_id=p_student and event_key=p_key) then return;end if;
 if exists(select 1 from agent_tasks where cycle_id=c.id and status not in ('completed','failed','canceled')) then raise exception 'Finish or cancel the active experiment before selecting a policy';end if;
 rollback:=p_evaluation is null and (p_version=c.baseline_id or exists(select 1 from research_events where cycle_id=c.id and kind='policy.selected' and payload->>'versionId'=p_version::text));
 if not rollback and not exists(select 1 from research_evaluations where id=p_evaluation and student_id=p_student and cycle_id=c.id and candidate_id=p_version and baseline_id=c.active_version_id and finding='supported') then raise exception 'A supported review against the current active version is required';end if;
 if not exists(select 1 from policy_versions where id=p_version and student_id=p_student) then raise exception 'Policy not found';end if;
 update research_cycles set active_version_id=p_version,updated_at=now() where id=c.id;
 perform research_append(p_student,c.id,p_key,'human','policy.selected',jsonb_build_object('versionId',p_version,'previousVersionId',c.active_version_id,'evaluationId',p_evaluation,'rollback',rollback,'text',p_reason),jsonb_build_array(jsonb_build_object('kind','revision','id',p_version)));
end $$;
create function research_model_event(p_student text,p_model text) returns void language plpgsql set search_path=public as $$
declare p preston_partnerships;
begin
 select * into p from preston_partnerships where student_id=p_student for update;
 if not found or p.current_model is not distinct from p_model then return;end if;
 update preston_partnerships set current_model=p_model where student_id=p_student;
 perform research_append(p_student,null,'model:'||gen_random_uuid(),'system','model.changed',jsonb_build_object('partnershipId',p.id,'previous',p.current_model,'current',p_model,'note','Model changed; recorded commitments and history remain. Behavior may change.'));
end $$;
create function research_carryover(p_student text,p_from uuid,p_to uuid,p_key text) returns void language plpgsql set search_path=public as $$
declare a research_cycles;b research_cycles;calls integer;games integer;
begin
 if p_from=p_to then raise exception 'Choose different cycles';end if;
 perform 1 from research_cycles where id in(p_from,p_to) and student_id=p_student order by id for update;
 select * into a from research_cycles where id=p_from and student_id=p_student;
 select * into b from research_cycles where id=p_to and student_id=p_student;
 if a.id is null or b.id is null or b.state='closed' then raise exception 'Cycle unavailable';end if;
 if exists(select 1 from research_events where student_id=p_student and event_key=p_key) then return;end if;
 calls:=least(a.call_limit-a.calls_allocated,2000-b.call_limit);
 games:=least(a.game_limit-a.games_allocated,20-b.game_limit);
 update research_cycles set call_limit=call_limit-calls,game_limit=game_limit-games where id=a.id;
 update research_cycles set call_limit=call_limit+calls,game_limit=game_limit+games where id=b.id;
 perform research_append(p_student,a.id,p_key,'human','allowance.transferred',jsonb_build_object('to',b.id,'modelCalls',calls,'hostedGames',games));
 perform research_append(p_student,b.id,p_key||':received','human','allowance.received',jsonb_build_object('from',a.id,'modelCalls',calls,'hostedGames',games));
end $$;
revoke all on function research_evaluate(text,uuid,uuid,text,text,text,text,text),research_select_policy(text,uuid,uuid,uuid,text,text),research_model_event(text,text),research_carryover(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function research_evaluate(text,uuid,uuid,text,text,text,text,text),research_select_policy(text,uuid,uuid,uuid,text,text),research_model_event(text,text),research_carryover(text,uuid,uuid,text) to service_role;
