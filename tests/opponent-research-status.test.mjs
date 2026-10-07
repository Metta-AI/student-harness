import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({ resolve(s, c, next) { try { return next(s, c); } catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' && s.startsWith('.') && !/\.[a-z]+$/i.test(s)) return next(`${s}.ts`, c); throw error; } } });
const rows = { opponent_notes: [], opponent_models: [] };
const requests = [];
let failedTable;
mock.module('../lib/db.ts', { namedExports: { db: () => ({ from(table) {
  const filters = []; let after; let count;
  const query = {
    select(columns) { assert.equal(columns, 'policy_id'); return query; },
    eq(key, value) { filters.push([key, value]); return query; },
    order(key, direction) { assert.equal(key, 'policy_id'); assert.equal(direction.ascending, true); return query; },
    limit(value) { count = value; return query; },
    gt(key, value) { assert.equal(key, 'policy_id'); after = value; return query; },
    then(resolve) {
      requests.push({ table, filters, after });
      const result = rows[table].filter(row => filters.every(([key, value]) => row[key] === value) && (!after || row.policy_id > after)).sort((a, b) => a.policy_id.localeCompare(b.policy_id)).slice(0, count);
      resolve({ data: failedTable === table ? null : result, error: failedTable === table ? { message: 'Unavailable' } : null });
    },
  };
  return query;
} }) } });
const { opponentResearchStatus } = await import('../lib/opponents/research-status.ts');
const row = (policy_id, student_id = 'alice', league_id = 'league-a') => ({ policy_id, student_id, league_id });
test('research badges distinguish notes and models and stay isolated by account and league', async () => {
  rows.opponent_notes = [row('notes-only'), row('both'), row('private', 'bob'), row('other-league', 'alice', 'league-b')];
  rows.opponent_models = [row('model-only'), row('both'), row('private-model', 'bob')];
  const status = new Map((await opponentResearchStatus('alice', 'league-a')).map(status => [status.policyId, status]));
  assert.equal(status.size, 3);
  assert.deepEqual(status.get('notes-only'), { policyId: 'notes-only', hasNotes: true, hasModel: false });
  assert.deepEqual(status.get('model-only'), { policyId: 'model-only', hasNotes: false, hasModel: true });
  assert.deepEqual(status.get('both'), { policyId: 'both', hasNotes: true, hasModel: true });
  assert.deepEqual(await opponentResearchStatus('charlie', 'league-a'), []);
});
test('research presence is complete beyond a page of records, skipping duplicate policy history', async () => {
  requests.length = 0;
  rows.opponent_notes = [...Array.from({ length: 1200 }, () => row('a')), row('b'), row('c')];
  rows.opponent_models = Array.from({ length: 501 }, (_, i) => row(`model-${String(i).padStart(4, '0')}`));
  const status = await opponentResearchStatus('alice', 'league-a');
  assert.equal(status.length, 504);
  assert(status.some(status => status.policyId === 'c' && status.hasNotes));
  assert(status.some(status => status.policyId === 'model-0500' && status.hasModel));
  assert.equal(requests.filter(request => request.table === 'opponent_notes').length, 2);
  assert.equal(requests.filter(request => request.table === 'opponent_models').length, 2);
});
test('unavailable research is not reported as an empty notebook', async () => {
  failedTable = 'opponent_models';
  try { await assert.rejects(() => opponentResearchStatus('alice', 'league-a'), /research status could not be loaded/); }
  finally { failedTable = undefined; }
});
