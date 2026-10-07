create table public.opponent_models (
 id uuid primary key default gen_random_uuid(),
 student_id text not null references public.students(subject_id) on delete cascade,
 league_id text not null, policy_id uuid not null,
 actor text not null check(actor in ('human','preston')),
 document jsonb not null,
 created_at timestamptz not null default now()
);
create index opponent_models_scope on public.opponent_models(student_id,league_id,policy_id,created_at desc);
alter table public.opponent_models enable row level security;
revoke all on public.opponent_models from anon,authenticated;
grant select,insert,update,delete on public.opponent_models to service_role;
alter table public.chat_sessions add column opponent_league_id text, add column opponent_policy_id uuid;
alter table public.chat_sessions add constraint opponent_session_scope check ((opponent_league_id is null) = (opponent_policy_id is null));
create index chat_opponent_scope on public.chat_sessions(student_id,opponent_league_id,opponent_policy_id) where opponent_policy_id is not null;
notify pgrst,'reload schema';
