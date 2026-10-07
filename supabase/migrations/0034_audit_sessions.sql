create table research_audit_sessions (
 id uuid primary key default gen_random_uuid(),student_id text not null references students(subject_id),
 task_id uuid not null unique references agent_tasks(id),campaign_id uuid references research_campaigns(id),
 scope_key text not null,release_hash text not null,release jsonb not null,vm_name text not null unique,
 sealed_key text not null,state text not null default 'starting',last_used_at timestamptz not null default now(),
 unique(student_id,scope_key,release_hash)
);
create table research_audit_jobs (
 audit_session_id uuid not null references research_audit_sessions(id),job_id text not null,episode_id text not null,
 state text not null,result jsonb,error text,updated_at timestamptz not null default now(),
 primary key(audit_session_id,job_id)
);
alter table research_audit_sessions enable row level security;
alter table research_audit_jobs enable row level security;
grant all on research_audit_sessions,research_audit_jobs to service_role;

create function audit_session_create(p_student text,p_scope text,p_campaign uuid,p_release jsonb,p_key text) returns research_audit_sessions
 language plpgsql security definer set search_path=public as $$
declare a research_audit_sessions;tid uuid;aid uuid:=gen_random_uuid();
begin
 perform pg_advisory_xact_lock(hashtextextended('audit:'||p_student||':'||p_scope||':'||(p_release->>'fingerprint'),0));
 select * into a from research_audit_sessions where student_id=p_student and scope_key=p_scope and release_hash=p_release->>'fingerprint';
 if found then return a;end if;
 if p_campaign is not null and not exists(select 1 from research_campaigns where id=p_campaign and student_id=p_student) then raise exception 'Campaign not found';end if;
 insert into agent_tasks(student_id,request_key,objective,acceptance_criteria,kind,max_games,status,phase,context,deadline_at,next_check_at)
 values(p_student,'audit:'||aid,'Audit replay evidence','Check release identity, world hashes, VM execution and reward ledgers; preserve all receipts.','research',0,'waiting','evaluate',
 jsonb_build_object('mode','audit','role','replay auditor','campaignId',p_campaign,'title','Replay auditor · dedicated VM'),'2100-01-01','2100-01-01') returning id into tid;
 insert into research_audit_sessions(id,student_id,task_id,campaign_id,scope_key,release_hash,release,vm_name,sealed_key)
 values(aid,p_student,tid,p_campaign,p_scope,p_release->>'fingerprint',p_release,'preston-audit-'||aid,p_key) returning * into a;
 return a;
end $$;
revoke all on function audit_session_create(text,text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function audit_session_create(text,text,uuid,jsonb,text) to service_role;
