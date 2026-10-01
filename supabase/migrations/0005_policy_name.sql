-- A characterful Softmax policy name per student, chosen by the agent from how the policy plays.
alter table public.students add column if not exists policy_name text;
