import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const url=process.env.TASK_TEST_DATABASE_URL;
const run=sql=>execFileSync('psql',[url,'-XqAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
const campaign='98000000-0000-4000-8000-000000000001',task='98000000-0000-4000-8000-000000000002';
const fixture=`insert into students(subject_id,email,sealed_token) values('campaign-test','campaign@test','unused');
insert into agent_tasks(id,student_id,request_key,objective,acceptance_criteria,kind,max_games,status) values('${task}','campaign-test','campaign-root','Improve wins','Audited improvement','research',0,'waiting');
insert into research_campaigns(id,student_id,task_id,request_key,league_id,objective,protocol) values('${campaign}','campaign-test','${task}','campaign-create','league-test','Improve wins','{}');`;
test('campaign model changes affect only future children and retain an owner-scoped event',{skip:!url},()=>{
 run(`begin;${fixture}
 insert into agent_tasks(student_id,request_key,objective,acceptance_criteria,kind,max_games,context)
 values('campaign-test','before-change','Research before','Evidence','research',0,'{"campaignId":"${campaign}"}');
 select campaign_set_model('${campaign}','campaign-test','{"model":"gpt-6-astra","effort":"xhigh"}');
 insert into agent_tasks(student_id,request_key,objective,acceptance_criteria,kind,max_games,context)
 values('campaign-test','after-change','Research after','Evidence','research',0,'{"campaignId":"${campaign}"}');
 do $$ begin
 if (select model_selection from agent_tasks where student_id='campaign-test' and request_key='before-change') is distinct from (select model_selection from agent_tasks where id='${task}') then raise exception 'old session changed';end if;
 if (select model_selection from agent_tasks where student_id='campaign-test' and request_key='after-change')<>'{"model":"gpt-6-astra","effort":"xhigh"}'::jsonb then raise exception 'future session ignored override';end if;
 if (select count(*) from research_campaign_events where campaign_id='${campaign}' and kind='model.changed')<>1 then raise exception 'change event missing';end if;
 begin perform campaign_set_model('${campaign}','foreign','{"model":"gpt-6.1-sol","effort":"high"}');raise exception 'foreign update allowed';exception when raise_exception then if sqlerrm='foreign update allowed' then raise;end if;end;
 begin perform campaign_set_model('${campaign}','campaign-test','{"model":null,"effort":"high"}');raise exception 'invalid model allowed';exception when check_violation then null;end;
 begin update agent_tasks set model_selection='{"model":"gpt-6-astra","effort":"high"}' where request_key='before-change';raise exception 'immutable snapshot overwritten';exception when raise_exception then if sqlerrm='immutable snapshot overwritten' then raise;end if;end;
 update research_campaigns set state='completed' where id='${campaign}';
 begin perform campaign_set_model('${campaign}','campaign-test','{"model":"gpt-6.1-sol","effort":"high"}');raise exception 'ended campaign changed';exception when raise_exception then if sqlerrm='ended campaign changed' then raise;end if;end;
 end $$;rollback;`);
});
test('campaign children inherit the frozen model, while new standalone sessions use new preferences',{skip:!url},()=>{
 run(`begin;${fixture}
 update students set chat_model='gpt-6-astra',reasoning_effort='xhigh' where subject_id='campaign-test';
 insert into agent_tasks(student_id,request_key,objective,acceptance_criteria,kind,max_games,context) values
 ('campaign-test','child','Model opponent','Saved evidence','research',0,'{"campaignId":"${campaign}"}'),
 ('campaign-test','standalone','New research','Saved evidence','research',0,'{}');
 do $$ begin
 if (select model_selection from agent_tasks where request_key='child' and student_id='campaign-test') is distinct from
 (select model_selection from agent_tasks where id='${task}') then raise exception 'child changed model';end if;
 if (select model_selection from agent_tasks where request_key='standalone' and student_id='campaign-test')<>'{"model":"gpt-6-astra","effort":"xhigh"}'::jsonb then raise exception 'new preferences ignored';end if;
 begin update agent_tasks set model_selection='{"model":"gpt-6-astra","effort":"low"}' where id='${task}';raise exception 'snapshot changed';exception when raise_exception then if sqlerrm='snapshot changed' then raise;end if;end;
 end $$;
 insert into students(subject_id,email,sealed_token) values('campaign-other','other@test','unused');
 do $$ begin
 begin insert into agent_tasks(student_id,request_key,objective,acceptance_criteria,kind,max_games,context) values('campaign-other','foreign','Invalid child','Saved evidence','research',0,'{"campaignId":"${campaign}"}');raise exception 'foreign child accepted';exception when raise_exception then if sqlerrm='foreign child accepted' then raise;end if;end;
 end $$;rollback;`);
});
test('campaign leases exclude overlapping dispatch; freeze is atomic and idempotent',{skip:!url},()=>{
 run(`begin;${fixture}
 do $$ declare c research_campaigns; payload jsonb;begin
 select * into c from campaign_claim('${campaign}');
 if c.lease_token is null then raise exception 'lease not claimed';end if;
 if exists(select 1 from campaign_claim('${campaign}')) then raise exception 'overlapping claim succeeded';end if;
 payload:='[{"cohort":"screen","protocol":{"pairs":1},"hash":"hash","fixtures":[{"episodeId":"ereq-one","seed":42}]}]'::jsonb;
 perform freeze_campaign_studies(c.id,c.lease_token,payload);
 perform freeze_campaign_studies(c.id,c.lease_token,payload);
 if (select count(*) from research_studies where campaign_id=c.id)<>1 then raise exception 'duplicate study';end if;
 if (select count(*) from research_fixtures where student_id='campaign-test')<>1 then raise exception 'duplicate fixture';end if;
 begin
 perform freeze_campaign_studies(c.id,c.lease_token,'[{"cohort":"confirmation","protocol":{"pairs":1},"hash":"hash","fixtures":[{"episodeId":"ereq-two","seed":42}]}]');
 raise exception 'consumed seed allowed';exception when unique_violation then null;end;
 if (select count(*) from research_studies where campaign_id=c.id)<>1 then raise exception 'partial failed freeze';end if;
 begin update research_studies set protocol='{}' where campaign_id=c.id;raise exception 'protocol changed';exception when raise_exception then if sqlerrm='protocol changed' then raise;end if;end;
 end $$;rollback;`);
});
test('paused campaigns cannot freeze new games and stale workers cannot write attempts',{skip:!url},()=>{
 run(`begin;${fixture}
 do $$ declare c research_campaigns;s research_studies;aid uuid;begin
 select * into c from campaign_claim('${campaign}');
 update research_campaigns set state='paused' where id=c.id;
 begin perform freeze_campaign_studies(c.id,c.lease_token,'[]');raise exception 'pause bypassed';exception when raise_exception then if sqlerrm='pause bypassed' then raise;end if;end;
 update research_campaigns set state='active' where id=c.id;
 perform freeze_campaign_studies(c.id,c.lease_token,'[{"cohort":"screen","protocol":{},"hash":"hash","fixtures":[{"episodeId":"ereq-one","seed":42}]}]');
 select * into s from research_studies where campaign_id=c.id;
 insert into research_attempts(study_id,fixture_id,arm,request_key,request) select s.id,id,'baseline','game-key','{"seed":42}' from research_fixtures where study_id=s.id returning id into aid;
 select * into s from study_claim(s.id);
 perform campaign_attempt_write(s.id,s.lease_token,aid,'{"xp_id":"xp-original","state":"requested"}');
 update research_studies set lease_until=now()-interval '1 second' where id=s.id;
 begin perform campaign_attempt_write(s.id,s.lease_token,aid,'{"xp_id":"xp-duplicate"}');raise exception 'stale receipt accepted';exception when raise_exception then if sqlerrm='stale receipt accepted' then raise;end if;end;
 if (select xp_id from research_attempts where id=aid)<>'xp-original' then raise exception 'receipt overwritten';end if;
 end $$;rollback;`);
});
test('new research tables are not accessible to browser roles',{skip:!url},()=>{
 const out=run(`select count(*) from pg_class where relname in ('research_campaigns','research_artifacts','research_studies','research_fixtures','research_attempts','research_deployments','research_campaign_events','research_exclusions') and relrowsecurity;
 select has_function_privilege('authenticated','campaign_claim(uuid)','execute');`);
 assert.deepEqual(out.trim().split('\n'),['8','f']);
});
test('campaign controls atomically fence workers and preserve session state and direction',{skip:!url},()=>{
 run(`begin;${fixture}
 do $$ declare c research_campaigns;begin
 select * into c from campaign_claim('${campaign}');
 perform campaign_control(c.id,'campaign-test','pause','Protect the current baseline');
 if (select status from agent_tasks where id='${task}')<>'paused' then raise exception 'root not paused';end if;
 if exists(select 1 from research_campaigns where id=c.id and lease_token=c.lease_token) then raise exception 'old worker unfenced';end if;
 perform campaign_control(c.id,'campaign-test','resume','');
 if (select checkpoint->>'direction' from research_campaigns where id=c.id)<>'Protect the current baseline' then raise exception 'direction lost';end if;
 if (select status from agent_tasks where id='${task}')<>'waiting' then raise exception 'root not parked';end if;
 end $$;rollback;`);
});
test('observed fixtures cannot be reserved and held-out fixtures cannot be inspected',{skip:!url},()=>{
 run(`begin;${fixture}
 do $$ declare c research_campaigns;begin
 select * into c from campaign_claim('${campaign}');
 perform freeze_campaign_studies(c.id,c.lease_token,'[{"cohort":"confirmation","protocol":{},"hash":"hash","fixtures":[{"episodeId":"ereq-held","seed":42}]}]');
 begin insert into research_exclusions values('campaign-test','league-test','ereq-held','42','research',now());raise exception 'held-out leaked';exception when raise_exception then if sqlerrm='held-out leaked' then raise;end if;end;
 insert into research_exclusions values('campaign-test','league-test','ereq-observed','43','research',now());
 begin perform freeze_campaign_studies(c.id,c.lease_token,'[{"cohort":"screen","protocol":{},"hash":"hash","fixtures":[{"episodeId":"ereq-other","seed":43}]}]');raise exception 'seed leaked';exception when raise_exception then if sqlerrm='seed leaked' then raise;end if;end;
 end $$;rollback;`);
});
test('replay auditor is its own session, idempotent per scope and release, with isolated VM identity',{skip:!url},()=>{
 run(`begin;${fixture}
 do $$ declare a research_audit_sessions;b research_audit_sessions;begin
 select * into a from audit_session_create('campaign-test','one','${campaign}','{"fingerprint":"release-one"}','sealed');
 select * into b from audit_session_create('campaign-test','one','${campaign}','{"fingerprint":"release-one"}','different-sealed');
 if a.id<>b.id or a.task_id<>b.task_id or a.sealed_key<>b.sealed_key then raise exception 'audit session duplicated';end if;
 if a.task_id='${task}' then raise exception 'auditor shares parent session';end if;
 select * into b from audit_session_create('campaign-test','two','${campaign}','{"fingerprint":"release-one"}','sealed');
 if a.vm_name=b.vm_name then raise exception 'different audit sessions share VM';end if;
 if (select context->>'mode' from agent_tasks where id=a.task_id)<>'audit' then raise exception 'not an audit session';end if;
 if (select next_check_at from agent_tasks where id=a.task_id)<'2099-01-01' then raise exception 'auditor queued as generic chat';end if;
 end $$;rollback;`);
});
test('generated fixtures can reuse observed lineups but cannot reuse observed or reserved seeds',{skip:!url},()=>{
 run(`begin;${fixture}
 do $$ declare c research_campaigns;begin
 select * into c from campaign_claim('${campaign}');
 insert into research_exclusions values('campaign-test','league-test','template-one','10','research',now());
 perform freeze_campaign_studies(c.id,c.lease_token,'[{"cohort":"screen","protocol":{"selectionMode":"fresh-seeds"},"hash":"screen","fixtures":[{"episodeId":"generated_screen","templateEpisodeId":"template-one","seed":100}]}]');
 perform freeze_campaign_studies(c.id,c.lease_token,'[{"cohort":"confirmation","protocol":{"selectionMode":"fresh-seeds"},"hash":"confirmation","fixtures":[{"episodeId":"generated_confirmation","templateEpisodeId":"template-one","seed":101}]}]');
 if (select count(*) from research_fixtures where student_id='campaign-test')<>2 then raise exception 'fresh cohorts missing';end if;
 begin insert into research_exclusions values('campaign-test','league-test','other-episode','101','research',now());raise exception 'reserved seed exposed';exception when raise_exception then if sqlerrm='reserved seed exposed' then raise;end if;end;
 update research_campaigns set cycle=1 where id=c.id;
 begin perform freeze_campaign_studies(c.id,c.lease_token,'[{"cohort":"screen","protocol":{},"hash":"bad","fixtures":[{"episodeId":"generated_bad","templateEpisodeId":"template-one","seed":10}]}]');raise exception 'observed seed reused';exception when raise_exception then if sqlerrm='observed seed reused' then raise;end if;end;
 end $$;rollback;`);
});
test('hosted accounting settles terminal prices once, retaining unknown and owner isolation',{skip:!url},()=>{
 run(`begin;${fixture}
 do $$ declare c research_campaigns;s research_studies;f uuid;a uuid;u jsonb;begin
 select * into c from campaign_claim('${campaign}');
 perform freeze_campaign_studies(c.id,c.lease_token,'[{"cohort":"screen","protocol":{},"hash":"hash","fixtures":[{"episodeId":"ereq-cost","seed":42}]}]');
 select * into s from research_studies where campaign_id=c.id;
 select id into f from research_fixtures where study_id=s.id;
 perform research_daily_reserve('campaign-test','study:paid-game');
 insert into research_attempts(study_id,fixture_id,arm,request_key,request,xp_id,receipt)
 values(s.id,f,'baseline','paid-game','{}','xp-one','{"episode":{"status":"submitted","cost_usd":0}}') returning id into a;
 u:=campaign_hosted_usage(c.id,'campaign-test');
 if (u->>'costReports')::int<>0 or (u->>'requests')::int<>1 then raise exception 'pending zero treated as price';end if;
 update research_attempts set receipt='{"episode":{"status":"completed","cost_usd":0.026}}' where id=a;
 update research_attempts set receipt=receipt where id=a;
 u:=campaign_hosted_usage(c.id,'campaign-test');
 if (u->>'reportedUsd')::numeric<>0.026 or (u->>'costReports')::int<>1 then raise exception 'cost missing or duplicated';end if;
 if (campaign_hosted_usage(c.id,'foreign')->>'requests')::int<>0 then raise exception 'foreign costs exposed';end if;
 perform research_daily_reserve('campaign-test','study:unknown-game');
 insert into research_attempts(study_id,fixture_id,arm,request_key,request,xp_id,receipt)
 values(s.id,f,'candidate','unknown-game','{}','xp-two','{"episode":{"status":"completed","cost_usd":null}}');
 u:=campaign_hosted_usage(c.id,'campaign-test');
 if (u->>'requests')::int<>2 or (u->>'costReports')::int<>1 then raise exception 'unknown counted as free';end if;
 update research_attempts set receipt='{"episode":{"status":"completed","cost_usd":0}}' where request_key='unknown-game';
 u:=campaign_hosted_usage(c.id,'campaign-test');
 if (u->>'costReports')::int<>2 or (u->>'reportedUsd')::numeric<>0.026 then raise exception 'reported free game missing';end if;
 end $$;rollback;`);
});

test('outcome summary is generated atomically without copying or changing native evidence',{skip:!url},()=>{
 run(`begin;${fixture}
 do $$ declare c research_campaigns;s research_studies;a uuid;f uuid;begin
 select * into c from campaign_claim('${campaign}');
 perform freeze_campaign_studies(c.id,c.lease_token,'[{"cohort":"screen","protocol":{},"hash":"hash","fixtures":[{"episodeId":"summary","seed":48}]}]');
 select * into s from research_studies where campaign_id=c.id;
 select id into f from research_fixtures where study_id=s.id;
 insert into research_attempts(study_id,fixture_id,arm,request_key,request) values(s.id,f,'baseline','summary-test','{}') returning id into a;
 if (select outcome_summary is not null from research_attempts where id=a) then raise exception 'pending result invented';end if;
 update research_attempts set result=jsonb_build_object('utility',0,'win',false,'xp',123,'evidence',jsonb_build_object('trace',repeat('native ',10000))) where id=a;
 if (select outcome_summary from research_attempts where id=a)<>'{"utility":0,"win":false,"xp":123}'::jsonb then raise exception 'summary differs';end if;
 if (select length(result->'evidence'->>'trace') from research_attempts where id=a)<>70000 then raise exception 'evidence changed';end if;
 update research_attempts set result=jsonb_set(result,'{xp}','321') where id=a;
 if (select outcome_summary->>'xp' from research_attempts where id=a)<>'321' then raise exception 'summary stale';end if;
 begin update research_attempts set outcome_summary='{}' where id=a;raise exception 'summary mutable';exception when generated_always then null;end;
 end $$;rollback;`);
});
