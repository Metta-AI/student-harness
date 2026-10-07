-- Shared GoTA hypotheses and working lessons. Each participant owns their own stance.
create table if not exists public.partner_claims (
  student_id text not null references public.students(subject_id) on delete cascade,
  id text not null,
  version integer not null check (version > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, id),
  check ((document->>'version')::integer = version),
  check (document->>'id' = id)
);
alter table public.partner_claims enable row level security;
revoke all on public.partner_claims from anon, authenticated;
grant select, insert, update, delete on public.partner_claims to service_role;
