-- How much the agent reasons before acting, chosen by the student in the chat composer.
-- There is no "off": the agent's model rejects a fully disabled thinking setting.
alter table students add column if not exists reasoning_effort text not null default 'low';
update students set reasoning_effort = 'low' where reasoning_effort not in ('low', 'medium', 'high');
alter table students drop constraint if exists students_reasoning_effort_check;
alter table students add constraint students_reasoning_effort_check check (reasoning_effort in ('low', 'medium', 'high'));
