import assert from 'node:assert/strict';import {test} from 'node:test';import {execFileSync} from 'node:child_process';
const url=process.env.TASK_TEST_DATABASE_URL;
test('database: transcripts are idempotent, account-scoped and private; views cannot leak to browser roles',{skip:!url},()=>{
 const sql=`begin;
 insert into students(subject_id,email,sealed_token) values('voice-a','a@voice.test','unused'),('voice-b','b@voice.test','unused');
 insert into voice_sessions(student_id,id,model) values('voice-a','test-live','gpt-live-1'),('voice-b','test-live','gpt-live-1');
 insert into voice_events(student_id,session_id,event_id,sequence,kind,role,text,start_ms,end_ms,received_at) values('voice-a','test-live','e1',0,'transcript','user','Hello',0,100,now());
 insert into voice_events(student_id,session_id,event_id,sequence,kind,role,text,received_at) values('voice-a','test-live','e1',0,'transcript','user','changed',now()) on conflict do nothing;
 insert into preston_views(student_id,title,document,league_id) values('voice-a','Other game','{}','league_ad6dc809-4696-46f5-99a5-fc2b1c58d082');
 insert into preston_views(student_id,title,document) values('voice-a','GoTA','{}');
 do $$ begin
 if (select count(*) from preston_views where student_id='voice-a' and league_id='league_3c60897b-25cf-4b37-9d1a-8554c1198f28')<>1 then raise exception 'view league scope';end if;
 if (select text from voice_events where student_id='voice-a' and event_id='e1')<>'Hello' then raise exception 'retry changed text';end if;
 if exists(select 1 from voice_events where student_id='voice-b') then raise exception 'cross-account events';end if;
 if has_table_privilege('anon','voice_events','SELECT') or has_table_privilege('authenticated','preston_views','SELECT') then raise exception 'browser access';end if;
 end $$;rollback;`;
 assert.doesNotThrow(()=>execFileSync('psql',[url,'-X','-q','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'}));
});
