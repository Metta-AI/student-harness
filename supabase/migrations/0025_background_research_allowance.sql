-- Preserve the standing-allowance wrapper while allowing concurrent research readers.
create or replace function research_start_plan_cycle(p_student text,p_plan uuid,p_manual boolean default false)
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
 if exists(select 1 from agent_tasks where kind='experiment' and student_id=p_student and status not in ('completed','failed','canceled')) then raise exception 'Another experiment is still active';end if;
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
 if p.mode='baseline' then
  update agent_tasks set phase='upload',checkpoint=checkpoint||jsonb_build_object('research_mode','baseline','version_id',base) where id=task;
 end if;
 update research_cycles set calls_allocated=calls_allocated+p.max_calls,games_allocated=games_allocated+1,updated_at=now() where id=c.id;
 update research_plans set status='running',task_id=task where id=p.id;
 perform research_append(p_student,c.id,'reservation:'||task,'preston','allowance.reserved',jsonb_build_object('planId',p.id,'taskId',task,'modelCalls',p.max_calls,'hostedGames',1,'rationale',p.rationale),p.evidence);
 perform task_enqueue(task,'created:'||task,'task.created');
 return task;
end $$;

create or replace function research_start_plan(p_student text,p_plan uuid,p_manual boolean default false) returns uuid language plpgsql security definer set search_path=public as $$
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
notify pgrst, 'reload schema';
