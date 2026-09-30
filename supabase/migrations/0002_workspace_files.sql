-- Text files from the student's optimizer lab (optimizer-seed/games/gods-of-the-arena) that
-- survive across chat sessions. Synced after every turn and written back on hydration.
create table if not exists public.workspace_files (
  student_id text not null references public.students(subject_id) on delete cascade,
  path text not null,
  content text not null,
  sha256 text not null,
  updated_at timestamptz not null default now(),
  primary key (student_id, path)
);
alter table public.workspace_files enable row level security;
