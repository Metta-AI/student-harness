-- Harness actions Hermes asked for in Ask mode, held until the Preston
-- conversation turns them into approval cards.
alter table hermes_conversations add column if not exists pending_approvals jsonb not null default '[]'::jsonb;
