import assert from 'node:assert/strict';import {test} from 'node:test';import {execFileSync} from 'node:child_process';
const url=process.env.TASK_TEST_DATABASE_URL;
test('opponent snapshots and notes persist under account/league scope with browser access disabled',{skip:!url},()=>{
 const sql=`begin;
 insert into students(subject_id,email,sealed_token) values('opponent-test','opponent@test.invalid','unused');
 insert into opponent_snapshots(student_id,league_id,policy_id,document) values('opponent-test','league-a','00000000-0000-4000-8000-000000000001','{}'),('opponent-test','league-b','00000000-0000-4000-8000-000000000001','{}');
 insert into opponent_notes(student_id,league_id,policy_id,actor,kind,text,evidence) values('opponent-test','league-a','00000000-0000-4000-8000-000000000001','preston','hypothesis','An explicitly untested hypothesis.','[]');
 insert into opponent_models(student_id,league_id,policy_id,actor,document) values('opponent-test','league-a','00000000-0000-4000-8000-000000000001','preston','{"schema":"gota-opponent-semantic-ir/1"}');
 insert into chat_sessions(session_id,student_id,title,host,opponent_league_id,opponent_policy_id) values('opponent-test-session','opponent-test','Model rival','localhost:3000','league-a','00000000-0000-4000-8000-000000000001');
 do $$ begin
 if (select count(*) from opponent_models where student_id='opponent-test' and league_id='league-a')<>1 then raise exception 'model persistence';end if;
 if (select opponent_league_id from chat_sessions where session_id='opponent-test-session')<>'league-a' then raise exception 'session link';end if;
 if has_table_privilege('anon','opponent_models','SELECT') or has_table_privilege('authenticated','opponent_models','INSERT') then raise exception 'model browser access';end if;
 if (select count(*) from opponent_snapshots where student_id='opponent-test' and league_id='league-a')<>1 then raise exception 'league isolation';end if;
 if has_table_privilege('anon','opponent_snapshots','SELECT') or has_table_privilege('authenticated','opponent_notes','INSERT') then raise exception 'browser access';end if;
 if not (select relrowsecurity from pg_class where oid='opponent_notes'::regclass) then raise exception 'RLS disabled';end if;
 end $$;rollback;`;
 assert.doesNotThrow(()=>execFileSync('psql',[url,'-X','-q','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'}));
});
