import assert from 'node:assert/strict';import {test} from 'node:test';import {execFileSync} from 'node:child_process';
const url=process.env.TASK_TEST_DATABASE_URL;
const run=body=>execFileSync('psql',[url,'-X','-q','-v','ON_ERROR_STOP=1','-tA'],{input:`begin;
insert into students(subject_id,email,sealed_token) values('autonomy-test','test@example.test','unused');
insert into policy_versions(id,student_id,revision_number,revision_id,summary,source,ir,receipts) values('b0000000-0000-0000-0000-000000000001','autonomy-test',1,'auto-base','Baseline','base','{}','{}');
${body}\nrollback;`,encoding:'utf8'});
test('autonomous investigation reserves standing capacity once and refunds unused work',{skip:!url},()=>assert.doesNotThrow(()=>run(`
do $$ declare w research_wakes;p uuid;t uuid;d jsonb; begin
 perform autoresearch_bootstrap('autonomy-test');
 select * into w from autoresearch_claim_wakes() where student_id='autonomy-test';
 if w.id is null then raise exception 'No wake';end if;
 if not autoresearch_reserve_call(w.id,w.token,'auto-call-1') then raise exception 'Call denied';end if;
 perform autoresearch_reserve_call(w.id,w.token,'auto-call-1');
 if (select calls_allocated from research_settings where student_id='autonomy-test')<>1 then raise exception 'Double billed';end if;
 d:='{"actions":[{"action":"investigate","question":"Why retreat too early?","objective":"Inspect retreat timing","criteria":"Compare survival and retreat behavior","rationale":"Retreat logic may be overly conservative","evidence":[{"kind":"revision","id":"b0000000-0000-0000-0000-000000000001"}],"mode":"baseline","maxCalls":6,"priority":50}],"briefing":"Inspecting retreat behavior","category":"progress","evidence":[]}';
 perform autoresearch_apply('autonomy-test',w.id,w.token,d);
 perform autoresearch_apply('autonomy-test',w.id,w.token,d);
 if (select count(*) from research_cycles where student_id='autonomy-test')<>1 then raise exception 'Duplicate cycle';end if;
 select id into p from research_plans where student_id='autonomy-test';
 t:=research_start_plan('autonomy-test',p,false);
 if research_start_plan('autonomy-test',p,false)<>t then raise exception 'Duplicate task';end if;
 if (select calls_allocated from research_settings where student_id='autonomy-test')<>7 then raise exception 'Reservation incorrect';end if;
 update research_settings set enabled=false where student_id='autonomy-test';
 if autoresearch_guard(t) then raise exception 'Paused work allowed';end if;
 update agent_tasks set status='canceled' where id=t;
 if (select calls_allocated from research_settings where student_id='autonomy-test')<>1 then raise exception 'Refund incorrect';end if;
 if (select games_allocated from research_settings where student_id='autonomy-test')<>0 then raise exception 'Game refund incorrect';end if;
 perform autoresearch_bootstrap('autonomy-test');
 if (select enabled from research_settings where student_id='autonomy-test') then raise exception 'Bootstrap unpaused work';end if;
end $$;`)));
test('expired, foreign and stale research leases cannot spend or apply decisions',{skip:!url},()=>assert.doesNotThrow(()=>run(`
do $$ declare w research_wakes;begin
 perform autoresearch_bootstrap('autonomy-test');select * into w from autoresearch_claim_wakes() where student_id='autonomy-test';
 if autoresearch_reserve_call(w.id,gen_random_uuid(),'bad-call') then raise exception 'Stale lease allowed';end if;
 update research_wakes set lease_until=now()-interval '1 minute' where id=w.id;
 if autoresearch_reserve_call(w.id,w.token,'expired-call') then raise exception 'Expired lease allowed';end if;
 begin perform autoresearch_apply('someone-else',w.id,w.token,'{}');raise exception 'Foreign wake allowed';exception when others then if sqlerrm<>'Research wake not found' then raise;end if;end;
 update research_settings set enabled=false where student_id='autonomy-test';
 if exists(select 1 from autoresearch_claim_wakes() where student_id='autonomy-test') then raise exception 'Paused wake claimed';end if;
end $$;`)));
