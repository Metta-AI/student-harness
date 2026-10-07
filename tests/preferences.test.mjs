import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) { try { return next(specifier, context); } catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context); throw error; } } });
const { defaultPreferences, preferenceInstructions } = await import('../lib/preferences.ts');
let student = { subjectId: 'alice' }, origin = true, broken = false;
const accounts = new Map([['alice', { ...defaultPreferences }], ['bob', { ...defaultPreferences }]]);
mock.module('../lib/session.ts', { namedExports: { currentSession: async () => student, sameOrigin: () => origin } });
mock.module('../lib/preferences-store.ts', { namedExports: {
  userPreferences: async id => { if (broken) throw Error('private database detail'); return accounts.get(id); },
  saveUserPreferences: async (id, patch) => { if (broken) throw Error('private database detail'); const saved = { ...accounts.get(id), ...patch }; accounts.set(id, saved); return saved; },
} });
mock.module('../lib/analytics-server.ts', { namedExports: { trackServer: async () => { throw Error('analytics offline'); } } });
const { GET, POST } = await import('../app/api/preferences/route.ts');
const request = body => new Request('http://localhost:3000/api/preferences', { method: 'POST', body: JSON.stringify(body) });

test('account preferences require sign-in and same-origin writes', async () => {
  student = null; assert.equal((await GET()).status, 401); assert.equal((await POST(request({ voice: 'vesper' }))).status, 401);
  student = { subjectId: 'alice' }; origin = false; assert.equal((await POST(request({ voice: 'vesper' }))).status, 403); origin = true;
});
test('validated partial updates preserve other settings and stay scoped to signed-in account', async () => {
  let response = await POST(request({ voice: 'vesper', preferredName: '  Aaron  ', responseLength: 'detailed', liveCaptions: false }));
  assert.equal(response.status, 200); assert.equal((await response.json()).preferredName, 'Aaron');
  response = await POST(request({ reasoningEffort: 'high' }));
  const saved = await response.json(); assert.equal(response.status, 200); assert.equal(saved.voice, 'vesper'); assert.equal(saved.reasoningEffort, 'high'); assert.equal(saved.liveCaptions, false);
  assert.deepEqual(accounts.get('bob'), defaultPreferences);
  const read = await GET(); assert.match(read.headers.get('cache-control'), /no-store/); assert.deepEqual(await read.json(), saved);
});
test('daily research budget is editable without resetting on unrelated patches', async () => {
 assert.equal(defaultPreferences.dailyResearchBudgetUsd,25);assert.equal(defaultPreferences.researchBudgetEnforced,false);
 let response=await POST(request({dailyResearchBudgetUsd:12,researchBudgetEnforced:true}));assert.equal((await response.json()).dailyResearchBudgetUsd,12);
 response=await POST(request({voice:'marin'}));const saved=await response.json();assert.equal(saved.dailyResearchBudgetUsd,12);assert.equal(saved.researchBudgetEnforced,true);
 for(const value of [-1,1001,'25'])assert.equal((await POST(request({dailyResearchBudgetUsd:value}))).status,400);
});

test('composer model and effort persist across unrelated preference updates',async()=>{
 let response=await POST(request({chatModel:'gpt-6-astra',reasoningEffort:'xhigh'}));
 assert.equal(response.status,200);
 response=await POST(request({voice:'marin'}));
 const saved=await response.json();
 assert.equal(saved.chatModel,'gpt-6-astra');assert.equal(saved.reasoningEffort,'xhigh');
 assert.equal((await POST(request({chatModel:'arbitrary-provider-model'}))).status,400);
});

test('unsupported voices, account injection, empty patches and malformed JSON are rejected', async () => {
  for (const body of [{ voice: 'made-up' }, { subjectId: 'bob', voice: 'marin' }, { preferredName: 'a'.repeat(81) }, { preferredName: 'a\nb' }, { liveCaptions: 'false' }, {}]) assert.equal((await POST(request(body))).status, 400);
  assert.equal((await POST(new Request('http://localhost/api/preferences', { method: 'POST', body: '{' }))).status, 400);
});
test('storage errors return retryable safe messages', async () => {
  broken = true;
  for (const response of [await GET(), await POST(request({ voice: 'marin' }))]) { assert.equal(response.status, 503); assert(!JSON.stringify(await response.json()).includes('private database')); }
  broken = false;
});
test('Live applies account voice and style to the audio session and background partner', async () => {
  const { liveSessionConfig } = await import('../lib/voice/config.ts');
  const preferences = { ...defaultPreferences, voice: 'vesper', preferredName: 'Aaron', responseLength: 'detailed' };
  const session = liveSessionConfig(preferences);
  assert.equal(session.audio.output.voice, 'vesper');
  assert(session.instructions.includes(preferenceInstructions(preferences)));
  assert(session.delegation.responses.instructions.includes(preferenceInstructions(preferences)));
  assert.equal(liveSessionConfig().audio.output.voice, 'marin');
});
