import assert from 'node:assert/strict';
import {test} from 'node:test';
import {humanIssues} from '../lib/tasks/human-issues.ts';

const task=(id,reason,extra={})=>({id,reason,status:'needs_input',updated_at:`2026-10-07T0${id}:00:00Z`,checkpoint:{},context:{},...extra});
test('repeated credit errors become one notice with all affected sessions',()=>{
  const reason='You have no credits remaining. Add credits to continue using the API at [Evidence](https://platform.openai.com/settings/organization/billing/).';
  const tasks=[task('1',reason),task('2',reason),task('3','OpenAI: insufficient quota')];
  const before=JSON.stringify(tasks);
  assert.deepEqual(humanIssues(tasks),[{key:'billing:openai',kind:'billing',text:'Preston is paused because API credits are exhausted.',taskIds:['3','2','1']}]);
  assert.equal(JSON.stringify(tasks),before,'Saved evidence stays unchanged');
});
test('questions deduplicate within a policy and episode without hiding distinct decisions',()=>{
  const issues=humanIssues([
    task('1','Should we regroup?',{context:{policyId:'p1',episodeId:'e1'}}),
    task('2','Should we regroup? ',{context:{policyId:'p1',episodeId:'e1'}}),
    task('3','Should we regroup?',{context:{policyId:'p1',episodeId:'e2'}}),
    task('4','Should we regroup?',{context:{policyId:'p2',episodeId:'e1'}}),
  ]);
  assert.equal(issues.length,3);
  assert.deepEqual(issues.at(-1).taskIds,['2','1']);
});
test('resolved and daily budget tasks stay out; unrelated providers remain separate',()=>{
  const issues=humanIssues([
    task('1','OpenAI no credits remaining'),task('2','Anthropic no credits remaining'),
    task('3','Connection failed'),task('4','Connection failed'),
    task('5','OpenAI no credits remaining',{status:'completed'}),
    task('6','Daily allowance',{checkpoint:{daily_budget_day:'2026-10-07'}}),
  ]);
  assert.equal(issues.length,3);
  assert.deepEqual(issues[0].taskIds,['4','3']);
});
