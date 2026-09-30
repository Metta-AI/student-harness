-- eve sessions live in the deployment's workflow store, so a chat is only resumable on the host
-- that created it. Record the host and list chats per host.
alter table public.chat_sessions add column if not exists host text;
create index if not exists chat_sessions_student_host on public.chat_sessions (student_id, host, updated_at desc);
