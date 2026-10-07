import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
const url=process.env.TASK_TEST_DATABASE_URL;
export const fixture=`insert into students(subject_id,email,sealed_token) values('research-test','research@test','unused'),('research-other','other@test','unused');
insert into policy_versions(id,student_id,revision_number,revision_id,summary,source,ir,receipts) values('a0000000-0000-0000-0000-000000000001','research-test',1,'research-base','Baseline','base','{}','{}');
select research_create_cycle('research-test','cycle-key','Why retreat too early?','Inspect retreat decisions','a0000000-0000-0000-0000-000000000001');`;
export function sql(body){return execFileSync('psql',[url,'-X','-q','-v','ON_ERROR_STOP=1','-tA'],{input:`begin;${fixture}\n${body}\nrollback;`,encoding:'utf8'});}
test('research database: immutable history, ownership and idempotent cycles',{skip:!url},()=>assert.doesNotThrow(()=>sql(`
do $$ declare c uuid; e uuid; begin
 select id into c from research_cycles where student_id='research-test';
 perform research_create_cycle('research-test','cycle-key','Duplicate cycle','Duplicate criteria','a0000000-0000-0000-0000-000000000001');
 if (select count(*) from research_cycles where student_id='research-test')<>1 then raise exception 'duplicate cycle'; end if;
 e:=research_append('research-test',c,'note-1','preston','position','{"text":"Maybe retreat"}');
 if e<>research_append('research-test',c,'note-1','preston','position','{}') then raise exception 'duplicate event'; end if;
 begin perform research_append('research-other',c,'bad','human','position');raise exception 'cross student allowed'; exception when others then if sqlerrm<>'Cycle not found' then raise; end if;end;
 begin update research_events set payload='{}' where id=e;raise exception 'rewrite allowed';exception when others then if sqlerrm not like 'Research history is append-only%' then raise;end if;end;
 begin perform research_append('research-other',null,'bad-ref','human','observation','{}','[{"kind":"revision","id":"a0000000-0000-0000-0000-000000000001"}]');raise exception 'evidence leaked';exception when others then if sqlerrm<>'Evidence must belong to this student' then raise;end if;end;
 if has_table_privilege('service_role','research_events','UPDATE') or has_table_privilege('anon','research_cycles','SELECT') then raise exception 'permissions';end if;
end $$;`)));
