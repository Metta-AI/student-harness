-- Closing a cycle must release its task slot and unused reservations.
create or replace function research_resume_tasks() returns void language plpgsql set search_path=public as $$
begin
 -- Lock tasks before releasing their cycle allocations, matching terminal task transitions.
 update agent_tasks t set status='canceled',reason='Research cycle closed',generation=generation+1,
 execution_key=null,lease_until=null,updated_at=now()
 from research_cycles c where t.cycle_id=c.id and c.state='closed'
 and t.status not in ('completed','failed','canceled');
 update research_plans p set status='canceled' from research_cycles c
 where p.cycle_id=c.id and c.state='closed' and p.status='proposed';
 update agent_tasks t set status='queued',reason='Cycle authority restored',generation=generation+1,attempts=0,updated_at=now()
 from research_cycles c where t.cycle_id=c.id and c.state='active' and c.expires_at>now() and c.autonomy
 and t.status='needs_input' and t.reason='Cycle authority paused or expired' and t.deadline_at>now();
end $$;

-- Review retries remain idempotent after the candidate has been selected.
create or replace function research_evaluate(p_student text,p_cycle uuid,p_candidate uuid,p_baseline_xp text,p_candidate_xp text,p_finding text,p_explanation text,p_key text)
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
 insert into research_evaluations(student_id,cycle_id,baseline_id,candidate_id,baseline_xp,candidate_xp,finding,explanation,request_key)
 values(p_student,c.id,c.active_version_id,p_candidate,p_baseline_xp,p_candidate_xp,p_finding,p_explanation,p_key)
 on conflict(student_id,request_key) do nothing returning id into evaluation;
 if evaluation is null then select id into evaluation from research_evaluations where student_id=p_student and request_key=p_key;end if;
 perform research_append(p_student,c.id,'evaluation:'||evaluation,'human','evaluation.recorded',
 jsonb_build_object('evaluationId',evaluation,'candidateId',p_candidate,'finding',p_finding,'text',p_explanation,'scope','Human-reviewed behavior; competitive improvement unverified'),
 jsonb_build_array(jsonb_build_object('kind','experiment','id',p_baseline_xp),jsonb_build_object('kind','experiment','id',p_candidate_xp)));
 return evaluation;
end $$;
