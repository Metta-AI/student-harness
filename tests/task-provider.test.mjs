import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {taskErrorMessage,isProviderRateLimit,isProviderBillingFailure,isProviderConfigurationFailure,isTransientInfrastructureFailure} from '../lib/tasks/failure.ts';
test('serialized child errors keep useful diagnostics without dumping provider request bodies',()=>{
 const message=taskErrorMessage({name:'AI_RetryError',message:'Failed after three attempts',cause:{message:'Rate limit reached for gpt-6-astra (429)'},request:{apiKey:'secret',body:'private'}});
 assert.match(message,/Rate limit/);assert(!message.includes('secret'));assert(isProviderRateLimit(message));
 assert.equal(taskErrorMessage({request:{apiKey:'secret'}}),'Agent execution failed');
 assert.equal(taskErrorMessage(new Error('native compile failed')),'native compile failed');
 assert(!isProviderRateLimit('429 insufficient_quota: billing limit'));
 assert(!isProviderRateLimit('429 credit_balance_exhausted: You have no credits remaining.'));
 assert(isProviderBillingFailure('You have no credits remaining. Add credits to continue using the API.'));
 assert(!isProviderRateLimit('Invalid schema'));
 assert(isTransientInfrastructureFailure('canceling statement due to statement timeout'));
 assert(isTransientInfrastructureFailure('Could not load session model selection'));
 assert(!isTransientInfrastructureFailure('Cannot select model: invalid API key'));
 assert(!isTransientInfrastructureFailure('line 525: syntax error'));
 assert(isProviderConfigurationFailure('Cannot select model codex/gpt-6-astra: supply modelContextWindowTokens'));
});
const url=process.env.TASK_TEST_DATABASE_URL;
const one='99000000-0000-4000-8000-000000000001',two='99000000-0000-4000-8000-000000000002';
const fixture=`insert into students(subject_id,email,sealed_token,chat_model,reasoning_effort) values('provider-test','provider@test','unused','gpt-6-astra','xhigh');
insert into agent_tasks(id,student_id,request_key,objective,acceptance_criteria,kind,max_games) values
('${one}','provider-test','one','Research one','Evidence','research',0),('${two}','provider-test','two','Research two','Evidence','research',0);`;
function run(body){return execFileSync('psql',[url,'-XqAt','-v','ON_ERROR_STOP=1'],{input:`begin;${fixture}${body}rollback;`,encoding:'utf8'});}
test('model slots pace across sessions, retry idempotently, and reject foreign or canceled generations',{skip:!url},()=>{
 run(`do $$ begin
 if task_model_slot('${one}','provider-test',0,'a')<>0 then raise exception 'first slot blocked';end if;
 if task_model_slot('${two}','provider-test',0,'b')<=0 then raise exception 'parallel burst allowed';end if;
 if task_model_slot('${one}','provider-test',0,'a')<>0 then raise exception 'retry blocked';end if;
 if task_model_slot('${two}','foreign',0,'b')<>-1 then raise exception 'foreign task allowed';end if;
 update task_model_pacing set next_at=now()-interval '1 second';
 if task_model_slot('${two}','provider-test',0,'b')<>0 then raise exception 'next slot blocked';end if;
 perform task_control('${one}','provider-test','pause');
 if task_model_slot('${one}','provider-test',0,'a')<>-1 then raise exception 'paused retry allowed';end if;
 end $$;`);
});
test('rate limits park with saved checkpoints, do not burn task retries, and wake only after cooldown',{skip:!url},()=>{
 run(`select task_claim('${one}','provider-test',0,'exec','session');
 update agent_tasks set checkpoint='{"evidence":"saved"}' where id='${one}';
 do $$ begin
 if task_provider_cooldown('${one}','stale','429') then raise exception 'stale failure changed task';end if;
 if not task_provider_cooldown('${one}','exec','429 rate limit') then raise exception 'cooldown missing';end if;
 if task_provider_cooldown('${one}','exec','429') then raise exception 'duplicate failure changed task';end if;
 if (select attempts from agent_tasks where id='${one}')<>0 then raise exception 'provider failure consumed retry';end if;
 if (select checkpoint->>'evidence' from agent_tasks where id='${one}')<>'saved' then raise exception 'evidence lost';end if;
 perform task_claim_events();
 if (select status from agent_tasks where id='${one}')<>'waiting' then raise exception 'cooldown bypassed';end if;
 update agent_tasks set checkpoint=jsonb_set(checkpoint,'{provider_retry_at}',to_jsonb(now()-interval '1 second')) where id='${one}';
 perform task_claim_events();
 if (select status from agent_tasks where id='${one}')<>'queued' then raise exception 'task stranded';end if;
 perform task_claim('${one}','provider-test',1,'next','session2');
 perform task_provider_cooldown('${one}','next','429');
 perform task_control('${one}','provider-test','cancel');
 update agent_tasks set checkpoint=jsonb_set(checkpoint,'{provider_retry_at}',to_jsonb(now()-interval '1 second')) where id='${one}';
 perform task_claim_events();
 if (select status from agent_tasks where id='${one}')<>'canceled' then raise exception 'canceled task resurrected';end if;
 end $$;`);
});
test('a fast session cannot starve an older waiter, and canceled waiters cannot block the queue',{skip:!url},()=>{
 run(`do $$ begin
 perform task_model_slot('${one}','provider-test',0,'a');
 perform task_model_slot('${two}','provider-test',0,'b');
 update task_model_pacing set next_at=now()-interval '1 second';
 if task_model_slot('${one}','provider-test',0,'c')<=0 then raise exception 'new call jumped queue';end if;
 if task_model_slot('${two}','provider-test',0,'b')<>0 then raise exception 'oldest waiter starved';end if;
 perform task_control('${one}','provider-test','cancel');
 update task_model_pacing set next_at=now()-interval '1 second';
 if task_model_slot('${two}','provider-test',0,'d')<>0 then raise exception 'canceled waiter blocks queue';end if;
 end $$;`);
});
test('unclaimed failed sessions get a fresh address after cooldown; stale and claimed failures are ignored',{skip:!url},()=>{
 run(`update agent_tasks set session_id='root',checkpoint='{"evidence":"preserved"}' where id='${one}';
 do $$ begin
 if task_dispatch_failed('${one}','foreign',0,'root','network',false) then raise exception 'foreign failure accepted';end if;
 if task_dispatch_failed('${one}','provider-test',0,'old-root','network',false) then raise exception 'stale session accepted';end if;
 if not task_dispatch_failed('${one}','provider-test',0,'root','network',false) then raise exception 'failure ignored';end if;
 if (select status from agent_tasks where id='${one}')<>'waiting' then raise exception 'dead session still queued';end if;
 if (select generation from agent_tasks where id='${one}')<>1 then raise exception 'failed address reused';end if;
 if (select checkpoint->>'evidence' from agent_tasks where id='${one}')<>'preserved' then raise exception 'checkpoint lost';end if;
 update agent_tasks set checkpoint=jsonb_set(checkpoint,'{provider_retry_at}',to_jsonb(now()-interval '1 second')) where id='${one}';
 perform task_claim_events();perform task_claim('${one}','provider-test',1,'exec','new-root');
 if task_dispatch_failed('${one}','provider-test',1,'new-root','network',false) then raise exception 'workflow recovery stolen';end if;
 end $$;`);
});
test('pre-claim billing/configuration failures ask for attention, while repeated transient failures are bounded',{skip:!url},()=>{
 run(`update agent_tasks set session_id='root' where id in ('${one}','${two}');
 do $$ begin
 perform task_dispatch_failed('${one}','provider-test',0,'root','No credits remaining',true);
 if (select status from agent_tasks where id='${one}')<>'needs_input' then raise exception 'billing failure hidden';end if;
 update agent_tasks set attempts=2 where id='${two}';
 perform task_dispatch_failed('${two}','provider-test',0,'root','network',false);
 if (select status from agent_tasks where id='${two}')<>'failed' then raise exception 'infinite pre-claim retry';end if;
 if has_function_privilege('authenticated','task_dispatch_failed(uuid,text,integer,text,text,boolean)','execute') then raise exception 'browser can forge failure';end if;
 end $$;`);
});
