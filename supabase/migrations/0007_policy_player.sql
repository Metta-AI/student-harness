-- The Softmax player a student's uploads are credited to. Kept on the student (their default
-- player, shown before an upload) and on each uploaded version (the player Softmax recorded for it).
alter table students add column if not exists softmax_player_id text;
alter table students add column if not exists softmax_player_name text;
alter table policy_versions add column if not exists softmax_player_id text;
alter table policy_versions add column if not exists softmax_player_name text;
