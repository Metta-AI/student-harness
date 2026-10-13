-- Hermes mode: one shared Hermes gateway sandbox per account, a mapping from
-- each Eve conversation to its Hermes session, and the reusable base image.
create table if not exists hermes_images (
 version text primary key,
 snapshot_id text not null,
 created_at timestamptz not null default now()
);
create table if not exists hermes_hosts (
 student_id text primary key references students(subject_id) on delete cascade,
 sandbox_name text not null unique,
 api_key_sealed text not null,
 hermes_version text not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists hermes_conversations (
 eve_session_id text primary key,
 student_id text not null references students(subject_id) on delete cascade,
 league_id text not null,
 hermes_session_id text not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists hermes_conversations_student on hermes_conversations(student_id);
alter table hermes_images enable row level security;
alter table hermes_hosts enable row level security;
alter table hermes_conversations enable row level security;
revoke all on hermes_images, hermes_hosts, hermes_conversations from anon, authenticated;
grant all on hermes_images, hermes_hosts, hermes_conversations to service_role;
