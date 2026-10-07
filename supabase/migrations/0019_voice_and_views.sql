-- Application-owned voice history and durable, declarative Preston views.
create table public.voice_sessions (
  student_id text not null references public.students(subject_id) on delete cascade,
  id text not null,
  model text not null,
  started_at timestamptz not null default now(),
  primary key(student_id,id)
);
create table public.voice_events (
  student_id text not null,
  session_id text not null,
  event_id text not null,
  sequence bigint not null check(sequence >= 0),
  kind text not null check(kind in ('transcript','lifecycle','tool')),
  role text check(role in ('user','assistant')),
  text text not null,
  start_ms double precision,
  end_ms double precision,
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key(student_id,session_id,event_id),
  foreign key(student_id,session_id) references public.voice_sessions(student_id,id) on delete cascade
);
create index voice_events_order on public.voice_events(student_id,session_id,sequence);
create table public.preston_views (
  student_id text not null references public.students(subject_id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  title text not null,
  document jsonb not null,
  created_at timestamptz not null default now(),
  primary key(student_id,id)
);
alter table public.voice_sessions enable row level security;
alter table public.voice_events enable row level security;
alter table public.preston_views enable row level security;
revoke all on public.voice_sessions, public.voice_events, public.preston_views from anon, authenticated;
grant select, insert, update, delete on public.voice_sessions, public.voice_events, public.preston_views to service_role;
notify pgrst, 'reload schema';
