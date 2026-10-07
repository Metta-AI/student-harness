import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
const url=process.env.TASK_TEST_DATABASE_URL;
test('research review: exact-version evidence, explicit promotion, rollback, carryover and model continuity',{skip:!url},()=>{
 const body=`begin;
 insert into students(subject_id,email,sealed_token) values('review-test','r@test','unused');
 insert into policy_versions(id,student_id,revision_number,revision_id,summary,source,ir,receipts) values
 ('d0000000-0000-0000-0000-000000000001','review-test',1,'review-base','baseline','base','{}','{}'),
 ('d0000000-0000-0000-0000-000000000002','review-test',2,'review-candidate','candidate','new','{}','{}');
 insert into experiments(student_id,policy_version_id,xp_request_id,title,status,summary) values
 ('review-test','d0000000-0000-0000-0000-000000000001','baseline-xp','Baseline','completed','{}'),
 ('review-test','d0000000-0000-0000-0000-000000000002','candidate-xp','Candidate','completed','{}');
 do $$ declare c research_cycles;next research_cycles;e uuid;partner uuid;begin
 c:=research_create_cycle('review-test','review-cycle','Test retreat behavior','Compare situations','d0000000-0000-0000-0000-000000000001');
 begin perform research_evaluate('review-test',c.id,'d0000000-0000-0000-0000-000000000002','candidate-xp','baseline-xp','supported','Claiming mismatched evidence','bad');raise exception 'wrong evidence accepted';exception when others then if sqlerrm<>'Review needs completed evidence for both exact policy versions' then raise;end if;end;
 e:=research_evaluate('review-test',c.id,'d0000000-0000-0000-0000-000000000002','baseline-xp','candidate-xp','inconclusive','Not enough behavioral evidence','eval-1');
 begin perform research_select_policy('review-test',c.id,'d0000000-0000-0000-0000-000000000002',e,'Use it','select-bad');raise exception 'inconclusive promoted';exception when others then if sqlerrm<>'A supported review against the current active version is required' then raise;end if;end;
 e:=research_evaluate('review-test',c.id,'d0000000-0000-0000-0000-000000000002','baseline-xp','candidate-xp','supported','Observed the intended behavior; rank unverified','eval-2');
 perform research_select_policy('review-test',c.id,'d0000000-0000-0000-0000-000000000002',e,'Use reviewed behavior','select');
 if research_evaluate('review-test',c.id,'d0000000-0000-0000-0000-000000000002','baseline-xp','candidate-xp','supported','Observed the intended behavior; rank unverified','eval-2')<>e then raise exception 'review retry changed identity';end if;
 perform research_select_policy('review-test',c.id,c.baseline_id,null,'Return to baseline','rollback');
 select id into partner from preston_partnerships where student_id='review-test';
 perform research_model_event('review-test','model-a');perform research_model_event('review-test','model-a');perform research_model_event('review-test','model-b');
 if (select count(*) from research_events where student_id='review-test' and kind='model.changed')<>2 then raise exception 'duplicate model event';end if;
 if (select id from preston_partnerships where student_id='review-test')<>partner then raise exception 'identity changed';end if;
 perform research_grant('review-test',c.id,48,2,now()+interval '1 day',false,5,'grant');
 next:=research_create_cycle('review-test','next-cycle','Investigate another behavior','Compare new evidence','d0000000-0000-0000-0000-000000000001');
 perform research_carryover('review-test',c.id,next.id,'carry');perform research_carryover('review-test',c.id,next.id,'carry');
 if (select call_limit from research_cycles where id=next.id)<>48 or (select call_limit from research_cycles where id=c.id)<>0 then raise exception 'carryover duplicated';end if;
 end $$;rollback;`;
 assert.doesNotThrow(()=>execFileSync('psql',[url,'-X','-q','-v','ON_ERROR_STOP=1'],{input:body,encoding:'utf8'}));
});
