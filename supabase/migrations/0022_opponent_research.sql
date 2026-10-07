create table public.opponent_snapshots (
 id uuid primary key default gen_random_uuid(),
 student_id text not null references public.students(subject_id) on delete cascade,
 league_id text not null, policy_id uuid not null,
 document jsonb not null, collected_at timestamptz not null default now()
);
create index opponent_snapshots_scope on public.opponent_snapshots(student_id,league_id,policy_id,collected_at desc);
create table public.opponent_notes (
 id uuid primary key default gen_random_uuid(),
 student_id text not null references public.students(subject_id) on delete cascade,
 league_id text not null, policy_id uuid not null,
 actor text not null check(actor in ('human','preston')),
 kind text not null check(kind in ('observation','hypothesis')),
 text text not null, evidence jsonb not null,
 created_at timestamptz not null default now()
);
create index opponent_notes_scope on public.opponent_notes(student_id,league_id,policy_id,created_at desc);
alter table public.opponent_snapshots enable row level security;
alter table public.opponent_notes enable row level security;
revoke all on public.opponent_snapshots,public.opponent_notes from anon,authenticated;
grant select,insert,update,delete on public.opponent_snapshots,public.opponent_notes to service_role;
notify pgrst,'reload schema';
