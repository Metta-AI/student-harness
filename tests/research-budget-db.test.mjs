import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
const url=process.env.TASK_TEST_DATABASE_URL;
test('research budget: atomic reservations, retry, exhaustion and unused release',{skip:!url},()=>{
 const body=`begin;
 insert into students(subject_id,email,sealed_token) values('budget-test','b@test','unused');
 insert into policy_versions(id,student_id,revision_number,revision_id,summary,source,ir,receipts) values('b0000000-0000-0000-0000-000000000001','budget-test',1,'budget-base','baseline','base','{}','{}');
 do $$ declare c research_cycles;p uuid;p2 uuid;t uuid;begin
 c:=research_create_cycle('budget-test','budget-cycle','Test retreat timing','Observe retreat changes','b0000000-0000-0000-0000-000000000001');
 perform research_grant('budget-test',c.id,24,1,now()+interval '1 day',true,5,'grant-1');
 p:=research_propose('budget-test',c.id,'plan-1','Improve retreat timing','Inspect retreat behavior','Tests the current retreat threshold','[]',24,10,'preston');
 t:=research_start_plan('budget-test',p);
 if research_start_plan('budget-test',p)<>t then raise exception 'duplicate task';end if;
 if (select calls_allocated from research_cycles where id=c.id)<>24 then raise exception 'reservation missing';end if;
 p2:=research_propose('budget-test',c.id,'plan-2','Improve tower timing','Inspect tower behavior','Test a second independent idea','[]',24,5,'preston');
 begin perform research_start_plan('budget-test',p2);raise exception 'overspend';exception when others then if sqlerrm<>'Research allowance exhausted' then raise;end if;end;
 update agent_tasks set model_calls=7,games_requested=1,status='completed',result='{"satisfied":false}' where id=t;
 if (select calls_allocated from research_cycles where id=c.id)<>7 then raise exception 'unused calls not released';end if;
 if (select games_allocated from research_cycles where id=c.id)<>1 then raise exception 'used game released';end if;
 if (select active_version_id from research_cycles where id=c.id)<>c.baseline_id then raise exception 'unverified promotion';end if;
 perform research_control('budget-test',c.id,'pause','pause-1');
 begin perform research_start_plan('budget-test',p2);raise exception 'paused work started';exception when others then if sqlerrm<>'Research allowance is paused or expired' then raise;end if;end;
 end $$;rollback;`;
 assert.doesNotThrow(()=>execFileSync('psql',[url,'-X','-q','-v','ON_ERROR_STOP=1'],{input:body,encoding:'utf8'}));
});
