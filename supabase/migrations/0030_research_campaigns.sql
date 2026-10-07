-- Campaigns own long-lived intent. Sessions remain the user-visible units of work.
create table research_campaigns (
 id uuid primary key default gen_random_uuid(), student_id text not null references students(subject_id),
 task_id uuid not null unique references agent_tasks(id), request_key text not null,
 league_id text not null, player_ids jsonb not null default '[]', objective text not null,
 state text not null default 'active' check(state in ('active','paused','canceled','completed')),
 phase text not null default 'baseline', cycle integer not null default 0,
 protocol jsonb not null, checkpoint jsonb not null default '{}',
 lease_token uuid, lease_until timestamptz, next_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(student_id,request_key), unique(id,student_id)
);
create table research_artifacts (
 id uuid primary key default gen_random_uuid(), student_id text not null references students(subject_id),
 campaign_id uuid, task_id uuid references agent_tasks(id), league_id text not null,
 kind text not null, title text not null, content_hash text not null,
 content jsonb not null, provenance jsonb not null default '{}', historical boolean not null default false,
 created_at timestamptz not null default now(),
 foreign key(campaign_id,student_id) references research_campaigns(id,student_id),
 unique(student_id,league_id,kind,content_hash)
);
create index research_artifact_lookup on research_artifacts(student_id,league_id,kind,created_at desc);
create table research_studies (
 id uuid primary key default gen_random_uuid(), student_id text not null, campaign_id uuid not null,
 task_id uuid not null references agent_tasks(id), cycle integer not null,
 cohort text not null check(cohort in ('screen','confirmation')),
 state text not null default 'running' check(state in ('running','auditing','completed','invalid','canceled')),
 protocol jsonb not null, protocol_hash text not null, result jsonb,
 lease_token uuid, lease_until timestamptz, next_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(campaign_id,student_id) references research_campaigns(id,student_id),
 unique(campaign_id,cycle,cohort), unique(id,student_id)
);
-- Reservations are shared across sessions, campaigns and cohorts, never only a local exclusion list.
create table research_fixtures (
 id uuid primary key default gen_random_uuid(), student_id text not null,
 study_id uuid not null, league_id text not null, episode_id text not null, seed_key text not null,
 fixture jsonb not null, created_at timestamptz not null default now(),
 foreign key(study_id,student_id) references research_studies(id,student_id),
 unique(student_id,league_id,episode_id), unique(student_id,league_id,seed_key)
);
create table research_attempts (
 id uuid primary key default gen_random_uuid(), study_id uuid not null references research_studies(id),
 fixture_id uuid not null references research_fixtures(id), arm text not null check(arm in ('baseline','candidate')),
 attempt integer not null default 0, request_key text not null unique, request jsonb not null,
 xp_id text, episode_id text, state text not null default 'created', receipt jsonb, result jsonb, error text,
 next_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(fixture_id,arm,attempt)
);
create index research_attempt_due on research_attempts(study_id,state,next_at);
create table research_deployments (
 id uuid primary key default gen_random_uuid(), student_id text not null, campaign_id uuid not null,
 study_id uuid not null references research_studies(id), player_id text not null,
 incumbent_id text not null, candidate_hash text not null, candidate_version_id text,
 state text not null default 'prepared', receipt jsonb not null default '{}', updated_at timestamptz not null default now(),
 foreign key(campaign_id,student_id) references research_campaigns(id,student_id),
 unique(study_id,player_id)
);
create unique index research_player_promotion_lock on research_deployments(student_id,player_id)
 where state in ('prepared','uploaded','submitted','verifying');
create table research_campaign_events (
 id bigint generated always as identity primary key, campaign_id uuid not null references research_campaigns(id),
 event_key text not null, kind text not null, payload jsonb not null default '{}', created_at timestamptz not null default now(),
 unique(campaign_id,event_key)
);

create function campaign_claim(p_id uuid) returns setof research_campaigns language sql security definer set search_path=public as $$
 update research_campaigns set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes'
 where id=p_id and (lease_until is null or lease_until<now()) and next_at<=now()
 returning *;
$$;
create function study_claim(p_id uuid) returns setof research_studies language sql security definer set search_path=public as $$
 update research_studies set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes'
 where id=p_id and state in ('running','auditing') and (lease_until is null or lease_until<now()) and next_at<=now()
 returning *;
$$;
create function campaign_evidence_immutable() returns trigger language plpgsql as $$
 begin raise exception 'Research evidence and frozen inputs are immutable'; end $$;
create trigger artifact_immutable before update on research_artifacts for each row execute function campaign_evidence_immutable();
create trigger fixture_immutable before update on research_fixtures for each row execute function campaign_evidence_immutable();
create function study_protocol_immutable() returns trigger language plpgsql as $$
 begin if new.protocol is distinct from old.protocol or new.protocol_hash<>old.protocol_hash then
 raise exception 'Study protocol is frozen'; end if;return new;end $$;
create trigger study_protocol_immutable before update on research_studies for each row execute function study_protocol_immutable();
create function attempt_inputs_immutable() returns trigger language plpgsql as $$
 begin if new.request is distinct from old.request or new.request_key<>old.request_key or new.fixture_id<>old.fixture_id or new.arm<>old.arm or new.attempt<>old.attempt then
 raise exception 'Attempt inputs are frozen';end if;return new;end $$;
create trigger attempt_inputs_immutable before update on research_attempts for each row execute function attempt_inputs_immutable();

-- These tables are accessed exclusively through authenticated, owner-scoped server code.
alter table research_campaigns enable row level security;
alter table research_artifacts enable row level security;
alter table research_studies enable row level security;
alter table research_fixtures enable row level security;
alter table research_attempts enable row level security;
alter table research_deployments enable row level security;
alter table research_campaign_events enable row level security;
revoke all on function campaign_claim(uuid),study_claim(uuid) from public,anon,authenticated;
grant execute on function campaign_claim(uuid),study_claim(uuid) to service_role;
grant all on research_campaigns,research_artifacts,research_studies,research_fixtures,research_attempts,research_deployments,research_campaign_events to service_role;
grant usage,select on sequence research_campaign_events_id_seq to service_role;
