-- Existing views were created in the default GoTA workspace.
alter table public.preston_views add column if not exists league_id text not null default 'league_3c60897b-25cf-4b37-9d1a-8554c1198f28';
create index if not exists preston_views_student_league_created on public.preston_views(student_id,league_id,created_at desc);
