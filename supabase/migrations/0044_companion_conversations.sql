-- A live call belongs to the same conversation as its typed follow-ups.
alter table public.voice_sessions
  add column chat_session_id text references public.chat_sessions(session_id) on delete set null,
  add column league_id text; -- Older calls have no reliable league scope; do not guess.
alter table public.voice_events add column after_message_id text;
create index voice_sessions_chat on public.voice_sessions(student_id, chat_session_id, started_at) where chat_session_id is not null;
notify pgrst, 'reload schema';
