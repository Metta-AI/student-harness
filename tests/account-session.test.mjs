import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'next/server') return next('next/server.js', context);
  try { return next(specifier, context); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context); throw error; }
} });
let session = null, identity = null, calls = 0, refreshed = null;
mock.module('../lib/session.ts', { namedExports: {
  currentSession: async () => session, cookieName: 'student_session', sameOrigin: () => true,
  setSessionCookie: (data, value) => { refreshed = value; return Response.json(data); },
} });
mock.module('../lib/db.ts', { namedExports: { upsertStudent: async () => {} } });
mock.module('../lib/player.ts', { namedExports: { resolveStudentPlayer: async () => null } });
mock.module('../lib/analytics-server.ts', { namedExports: { identifyServer: async () => {}, trackServer: async () => {} } });
mock.module('../lib/softmax.ts', { namedExports: {
  whoami: async (_token, signal) => { calls++; if(typeof identity === "function")return identity(signal); if (identity instanceof Error) throw identity; return identity; },
  SoftmaxError: class extends Error {},
} });
const { GET, POST } = await import('../app/api/session/route.ts');
const legacy = { email: 'ada@example.test', subjectId: 'ada', token: 'private-token' };
test('account name refresh preserves old sessions and never exposes the token', async () => {
  session = { ...legacy }; identity = { subject_id: 'ada', name: 'Ada Lovelace' }; refreshed = null;
  assert.deepEqual(await (await GET()).json(), { email: legacy.email, subjectId: 'ada', name: 'Ada Lovelace' });
  assert.deepEqual(refreshed, { ...legacy, name: 'Ada Lovelace' });
  session = refreshed; calls = 0;
  assert.equal((await (await GET()).json()).name, 'Ada Lovelace');
  assert.equal(calls, 0);
});
test('missing identity service or a different identity cannot overwrite the account', async () => {
  session = { ...legacy }; refreshed = null;
  for (const result of [new Error('Unavailable'), { subject_id: 'someone-else', name: 'Other' }]) {
    identity = result;
    assert.deepEqual(await (await GET()).json(), { email: legacy.email, subjectId: 'ada', name: null });
    assert.equal(refreshed, null);
  }
  session = null;
  assert.deepEqual(await (await GET()).json(), { email: null });
});
test('sign-in returns and stores the authenticated account name', async () => {
  identity = { subject_id: 'ada', subject_type: 'user', user_email: legacy.email, name: 'Ada Lovelace' };
  const response = await POST(new Request('http://localhost/api/session', { method: 'POST', body: JSON.stringify({ token: legacy.token }) }));
  assert.deepEqual(await response.json(), { email: legacy.email, subjectId: 'ada', name: 'Ada Lovelace' });
  assert.deepEqual(refreshed, { ...legacy, name: 'Ada Lovelace' });
});

test('a stalled optional name lookup cannot prevent an authenticated session from loading', async () => {
  session = { ...legacy }; refreshed = null;
  identity = signal => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once:true}));
  const keepAlive = setTimeout(() => {}, 4000);
  const start = Date.now();
  try {
    assert.deepEqual(await (await GET()).json(), {email: legacy.email, subjectId:'ada', name:null});
    assert(Date.now()-start < 3000);
    assert.equal(refreshed,null);
  } finally { clearTimeout(keepAlive); }
});
