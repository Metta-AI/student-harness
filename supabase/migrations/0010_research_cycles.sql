-- A partnership identity survives conversations and model changes.
create table public.preston_partnerships (
  student_id text primary key references students(subject_id) on delete cascade,
  id uuid not null unique default gen_random_uuid(), current_model text,
  created_at timestamptz not null default now()
);
create table public.research_cycles (
  id uuid primary key default gen_random_uuid(), student_id text not null references students(subject_id) on delete cascade,
  request_key text not null, question text not null, criteria text not null,
  baseline_id uuid not null references policy_versions(id), active_version_id uuid not null references policy_versions(id),
  state text not null default 'draft' check(state in ('draft','active','paused','closed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(student_id,request_key)
);
create table public.research_events (
  id uuid primary key default gen_random_uuid(), sequence bigint generated always as identity unique,
  student_id text not null references students(subject_id) on delete cascade,
  cycle_id uuid references research_cycles(id), event_key text not null,
  actor text not null check(actor in ('human','preston','system')), kind text not null,
  payload jsonb not null default '{}' check(jsonb_typeof(payload)='object'),
  evidence jsonb not null default '[]' check(jsonb_typeof(evidence)='array'),
  supersedes uuid references research_events(id), created_at timestamptz not null default now(),
  unique(student_id,event_key)
);
create index research_events_cycle on research_events(student_id,cycle_id,sequence);
alter table preston_partnerships enable row level security;
alter table research_cycles enable row level security;
alter table research_events enable row level security;
revoke all on preston_partnerships,research_cycles,research_events from anon,authenticated;
grant select,insert,update on preston_partnerships,research_cycles to service_role;
grant select,insert on research_events to service_role;
revoke update,delete on research_events from service_role;
grant usage,select on sequence research_events_sequence_seq to service_role;
create function public.research_immutable() returns trigger language plpgsql as $$
begin raise exception 'Research history is append-only; append a correction instead'; end $$;
create trigger research_history_immutable before update or delete on research_events for each row execute function research_immutable();

create function public.research_append(p_student text,p_cycle uuid,p_key text,p_actor text,p_kind text,
 p_payload jsonb default '{}',p_evidence jsonb default '[]',p_supersedes uuid default null)
returns uuid language plpgsql set search_path=public as $$
declare event_id uuid; e jsonb;
begin
 if p_cycle is not null and not exists(select 1 from research_cycles where id=p_cycle and student_id=p_student) then raise exception 'Cycle not found'; end if;
 if p_supersedes is not null and not exists(select 1 from research_events where id=p_supersedes and student_id=p_student and cycle_id is not distinct from p_cycle) then raise exception 'Previous statement not found'; end if;
 if jsonb_array_length(p_evidence)>20 then raise exception 'Too many evidence references'; end if;
 for e in select * from jsonb_array_elements(p_evidence) loop
   if not (case e->>'kind'
    when 'revision' then exists(select 1 from policy_versions where id::text=e->>'id' and student_id=p_student)
    when 'experiment' then exists(select 1 from experiments where xp_request_id=e->>'id' and student_id=p_student)
    when 'claim' then exists(select 1 from partner_claims where id=e->>'id' and student_id=p_student)
    when 'moment' then exists(select 1 from research_events where id::text=e->>'id' and student_id=p_student and kind='moment')
    else false end) then raise exception 'Evidence must belong to this student'; end if;
 end loop;
 insert into research_events(student_id,cycle_id,event_key,actor,kind,payload,evidence,supersedes)
 values(p_student,p_cycle,p_key,p_actor,p_kind,p_payload,p_evidence,p_supersedes)
 on conflict(student_id,event_key) do nothing returning id into event_id;
 if event_id is null then select id into event_id from research_events where student_id=p_student and event_key=p_key; end if;
 return event_id;
end $$;
create function public.research_create_cycle(p_student text,p_key text,p_question text,p_criteria text,p_baseline uuid)
returns public.research_cycles language plpgsql set search_path=public as $$
declare c research_cycles;
begin
 if not exists(select 1 from policy_versions where id=p_baseline and student_id=p_student) then raise exception 'Baseline must belong to your workspace'; end if;
 insert into preston_partnerships(student_id) values(p_student) on conflict do nothing;
 insert into research_cycles(student_id,request_key,question,criteria,baseline_id,active_version_id)
 values(p_student,p_key,p_question,p_criteria,p_baseline,p_baseline) on conflict(student_id,request_key) do nothing returning * into c;
 if c.id is null then select * into c from research_cycles where student_id=p_student and request_key=p_key; end if;
 perform research_append(p_student,c.id,'cycle:'||c.id,'human','cycle.created',jsonb_build_object('question',c.question,'criteria',c.criteria),jsonb_build_array(jsonb_build_object('kind','revision','id',c.baseline_id)));
 return c;
end $$;
create function public.research_claim_history() returns trigger language plpgsql set search_path=public as $$
begin
 perform research_append(new.student_id,null,'claim:'||new.id||':'||new.version,
  case when new.document->'history'->-1->>'actor'='human' or (tg_op='INSERT' and new.document->>'author'='human') then 'human' else 'preston' end,
  'claim.snapshot',jsonb_build_object('claim',new.document));
 return new;
end $$;
create trigger research_claim_history after insert or update on partner_claims for each row execute function research_claim_history();
-- Import only what was actually retained; do not invent past event timestamps.
insert into research_events(student_id,event_key,actor,kind,payload)
 select student_id,'claim-import:'||id||':'||version,'system','claim.imported',jsonb_build_object('claim',document,'imported',true) from partner_claims;
revoke all on function research_append(text,uuid,text,text,text,jsonb,jsonb,uuid),research_create_cycle(text,text,text,text,uuid),research_claim_history(),research_immutable() from public,anon,authenticated;
grant execute on function research_append(text,uuid,text,text,text,jsonb,jsonb,uuid),research_create_cycle(text,text,text,text,uuid),research_claim_history() to service_role;
