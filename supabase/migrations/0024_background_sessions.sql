alter table agent_tasks add column kind text not null default 'experiment' check(kind in ('experiment','research'));
alter table agent_tasks add column context jsonb not null default '{}';
alter table agent_tasks alter column base_version_id drop not null;
alter table agent_tasks add constraint experiment_requires_policy check(kind='research' or base_version_id is not null);
alter table agent_tasks drop constraint agent_tasks_max_games_check;
alter table agent_tasks add constraint task_game_scope check((kind='research' and max_games=0) or (kind='experiment' and max_games=1));
drop index agent_tasks_one_active_student;
create unique index agent_tasks_one_active_student on agent_tasks(student_id) where kind='experiment' and status not in ('completed','failed','canceled');

create function task_steer(p_task uuid,p_student text,p_note text) returns agent_tasks language plpgsql set search_path=public as $$
declare t agent_tasks;
begin
 if length(trim(p_note))<1 or length(p_note)>2000 then raise exception 'Provide a direction';end if;
 select * into t from agent_tasks where id=p_task and student_id=p_student for update;
 if not found then raise exception 'Task not found';end if;
 if t.status in ('completed','failed','canceled') or t.deadline_at<=now() then raise exception 'Task is finished or expired';end if;
 update agent_tasks set status='queued',generation=generation+1,execution_key=null,lease_until=null,
 checkpoint=checkpoint||jsonb_build_object('student_note',p_note),reason='Direction updated',updated_at=now()
 where id=t.id returning * into t;
 perform task_enqueue(t.id,'steer:'||t.id||':'||t.generation,'task.steered');
 return t;
end $$;
revoke all on function task_steer(uuid,text,text) from public,anon,authenticated;
grant execute on function task_steer(uuid,text,text) to service_role;

create or replace function research_start_plan(p_student text,p_plan uuid,p_manual boolean default false)
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

create or replace function autoresearch_claim_wakes() returns setof research_wakes language plpgsql set search_path=public as $$
begin
 -- Wake after a saved first policy, and after real experiment outcomes. No idle busywork.
 insert into research_wakes(student_id,event_key,reason)
 select s.student_id,'policy:'||v.id,'A policy revision was saved; consider whether it changes the research agenda'
 from research_settings s join lateral(select id from policy_versions where student_id=s.student_id order by revision_number desc limit 1) v on true
 where s.enabled and not exists(select 1 from agent_tasks where kind='experiment' and student_id=s.student_id and status not in ('completed','failed','canceled'))
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
  and not exists(select 1 from agent_tasks t where t.kind='experiment' and t.student_id=w.student_id and t.status not in ('completed','failed','canceled'))
  order by w.created_at limit 20 for update of w skip locked
 ) update research_wakes w set status='running',token=gen_random_uuid(),lease_until=now()+interval '10 minutes',attempts=attempts+1
 from eligible e where w.id=e.id returning w.*;
end $$;

notify pgrst,'reload schema';
