import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if(specifier === 'next/server') return next('next/server.js', context);
  try { return next(specifier, context); }
  catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context); throw e; }
} });
let calls = [], signedIn = true, sameSite = true;
const record = name => async (...args) => { calls.push({ name, args }); return { id: 'saved' }; };
mock.module('../lib/research/store.ts', { namedExports: Object.fromEntries(['appendNote','createCycle','readResearch','recordMoment','grantAllowance','proposeExperiment'].map(name => [name, record(name)])) });
mock.module('../lib/tasks/store.ts', { namedExports: { rpc: record('rpc') } });
mock.module('../lib/session.ts', { namedExports: { currentSession: async () => signedIn ? { subjectId: 'alice' } : null, sameOrigin: () => sameSite } });
mock.module('next/server.js', { namedExports: { NextResponse: Response } });
const api = await import('../app/api/research/route.ts');
const { default: partner } = await import('../agent/tools/research_partner.ts');
const { default: authority } = await import('../agent/tools/research_authority.ts');
const ctx = { session: { id: 'chat-1', auth: { current: { authenticator: 'student-harness', principalId: 'alice', attributes: {} } } }, callId: 'call-1' };
const post = input => api.POST(new Request('http://localhost/api/research', { method: 'POST', body: JSON.stringify(input) }));
test('research HTTP rejects unauthenticated and cross-origin writes before invoking mutations', async () => {
  calls=[]; signedIn=false;
  assert.equal((await api.GET()).status,401); assert.equal((await post({action:'grant'})).status,401);
  signedIn=true; sameSite=false;
  assert.equal((await post({action:'grant'})).status,403); assert.equal(calls.length,0); sameSite=true;
});
test('research HTTP attributes contributions to the signed-in human, never a supplied actor or student', async () => {
  calls=[];
  assert.equal((await post({action:'note',studentId:'bob',actor:'preston',text:'My contribution'})).status,201);
  assert.equal(calls[0].args[0],'alice'); assert.equal(calls[0].args[2],'human');
});
test('Preston records only its own position and cannot grant itself an allowance', async () => {
  calls=[];
  await partner.execute({action:'note',note:{text:'I disagree',actor:'human'}},ctx);
  assert.equal(calls[0].args[0],'alice'); assert.equal(calls[0].args[2],'preston');
  assert.equal(partner.inputSchema.safeParse({action:'grant'}).success,false);
  assert.equal(partner.availableInSubagents,false);
});
test('human authority actions always require a runtime approval, including grants and policy selection', async () => {
  assert.equal(await authority.approval({}), 'user-approval');
  assert.equal(authority.availableInSubagents,false);
  calls=[];
  await authority.execute({action:'grant',allowance:{modelCalls:24,hostedGames:1}},ctx);
  assert.equal(calls[0].name,'grantAllowance'); assert.equal(calls[0].args[0],'alice');
  assert.equal(calls[0].args[1].requestKey,'authority:chat-1:call-1');
});
