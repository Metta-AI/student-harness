-- Student workspace: durable per-student state behind the arena coach.
-- Only the server (service role) touches these tables. RLS is enabled with no
-- policies so the anon and authenticated roles cannot read them through the Data API.

create table if not exists public.students (
  subject_id text primary key,
  email text not null,
  sealed_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.policy_versions (
  id uuid primary key default gen_random_uuid(),
  student_id text not null references public.students(subject_id) on delete cascade,
  revision_number integer not null,
  revision_id text not null,
  parent_revision_id text,
  summary text not null,
  source text not null,
  ir jsonb not null,
  receipts jsonb not null,
  evidence jsonb not null default '[]'::jsonb,
  softmax_policy_version_id text,
  softmax_policy_label text,
  created_at timestamptz not null default now(),
  unique (student_id, revision_number),
  unique (student_id, revision_id)
);
create index if not exists policy_versions_student_created on public.policy_versions (student_id, created_at desc);

create table if not exists public.experiments (
  id uuid primary key default gen_random_uuid(),
  student_id text not null references public.students(subject_id) on delete cascade,
  policy_version_id uuid not null references public.policy_versions(id) on delete cascade,
  xp_request_id text not null unique,
  title text not null,
  hypothesis text,
  status text not null default 'pending',
  episodes jsonb not null default '[]'::jsonb,
  summary jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists experiments_student_created on public.experiments (student_id, created_at desc);

create table if not exists public.chat_sessions (
  session_id text primary key,
  student_id text not null references public.students(subject_id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists chat_sessions_student_updated on public.chat_sessions (student_id, updated_at desc);

alter table public.students enable row level security;
alter table public.policy_versions enable row level security;
alter table public.experiments enable row level security;
alter table public.chat_sessions enable row level security;
