-- Hosted games the student requested elsewhere (CLI, Observatory, older harness) can be
-- checked and recorded without a saved revision to attach to.
alter table public.experiments alter column policy_version_id drop not null;
