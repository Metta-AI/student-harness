import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const baseURL = process.env.BROWSER_TEST_URL || 'http://localhost:3000';
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
page.setDefaultTimeout(25000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
let workspaceFails = true, researchMode = 'slow', researchReads = 0, autonomyReads = 0;
const pending = [];
const opponentPending = [];
let opponentReads = 0, notebookReads = 0;
let slowRoster = true, slowNotebook = true;
const research = { available: true, cycles: [], events: [], plans: [], evaluations: [], versions: [], experiments: [{ xp_request_id: 'slow-result', policy_version_id: 'policy-1', title: 'Slow response recovered', status: 'completed' }] };
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== new URL(baseURL).origin) return route.abort();
  const send = json => route.fulfill({ json });
  if (url.pathname === '/api/session') return send({ email: 'alice@example.com', name: 'Alice', subjectId: 'alice' });
  if (url.pathname === '/api/workspace') return workspaceFails ? route.fulfill({ status: 503, json: { error: 'Database unavailable' } }) : send({ versions: [], experiments: [], latest: null, latestUpload: null, player: null, draft: null });
  if (url.pathname === '/api/arena') return send({ league: { rounds_paused_at: null }, episodes: [] });
  if (url.pathname === '/api/policy-stats') return send({ policies: [], standings: [], entries: [], entered: [], checkedAt: new Date().toISOString() });
  if (url.pathname === '/api/partner') return send({ available: true, claims: [] });
  if (url.pathname === '/api/research' || url.pathname === '/api/research/autonomy') {
    const autonomy = url.pathname.endsWith('/autonomy');
    if (autonomy) autonomyReads++; else researchReads++;
    if (researchMode === 'slow') return new Promise(resolve => pending.push(async () => { await send(autonomy ? {settings: null} : research); resolve(); }));
    if (researchMode === 'stalled') return;
    return send(autonomy ? {settings: null} : research);
  }
  if (url.pathname === '/api/tasks') return send({ tasks: [], workers: [] });
  if (url.pathname === '/api/chats') return send({ chats: [] });
  if (url.pathname === '/api/views') return send({ views: [] });
  if (url.pathname === '/api/coaching' || url.pathname === '/api/voice/transcripts') return send({ sessions: [] });
  if (url.pathname === '/api/preferences') return send({ liveCaptions: true });
  if (url.pathname === '/api/opponents') {
    const notebook = url.searchParams.has('policy');
    if (notebook) notebookReads++; else opponentReads++;
    const data = notebook
      ? { snapshots: [], notes: [{id: 'note', kind: 'observation', actor: 'preston', text: 'Slow opponent analysis recovered.', evidence: [], created_at: new Date().toISOString()}], models: [], tasks: [], sessions: [] }
      : { profiles: [{policyId: 'opponent-1', policyLabel: 'rival:v1', playerName: 'Patient Rival', rank: 1, rating: 20, ratingLabel: 'MMR', episodes: 10, own: false}], tracked: [], research: [], checkedAt: new Date().toISOString(), leagueURL: 'https://softmax.com/observatory/v2' };
    // Hold each initial read beyond one polling interval. Later polls are immediate.
    if (notebook ? slowNotebook : slowRoster) return new Promise(resolve => opponentPending.push(async () => {await send(data); resolve();}));
    return send(data);
  }
  if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, json: { error: 'No fixture' } });
  return route.continue();
});
try {
  await page.goto(baseURL, {waitUntil: 'domcontentloaded'});
  await page.getByRole('button', { name: 'Retry workspace', exact: true }).waitFor();
  workspaceFails = false;
  await page.getByRole('button', { name: 'Retry workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Retry workspace', exact: true }).waitFor({state: 'detached'});
  assert.equal(researchReads, 0, 'Hidden experiments must not poll');
  await page.getByRole('button', { name: 'Preston’s Lab', exact: true }).click();
  await page.getByText('Loading experiments…', {exact: true}).waitFor();
  await page.waitForTimeout(250); // Lab mounts on demand; development Strict Mode can remount it.
  const initialResearchReads = researchReads;
  const initialAutonomyReads = autonomyReads;
  await page.waitForTimeout(11000);
  assert.equal(researchReads, initialResearchReads, 'A slow read must not be superseded by polling');
  assert.equal(autonomyReads, initialAutonomyReads);
  await Promise.all(pending.splice(0).map(release => release()));
  await page.getByRole('button', {name: 'Slow response recovered', exact: true}).waitFor();
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.waitForTimeout(11000);
  assert.equal(researchReads, initialResearchReads, 'Leaving Lab stops polling');
  researchMode = 'stalled';
  await page.getByRole('button', { name: 'Preston’s Lab', exact: true }).click();
  await page.waitForTimeout(250);
  const stalledReads = researchReads;
  await page.getByText('Research is taking too long to respond. Please retry.', {exact: false}).waitFor();
  assert.equal(researchReads, stalledReads, 'A stalled request must time out without overlapping polls');
  researchMode = 'healthy';
  await page.getByRole('button', {name: 'Retry', exact: true}).click();
  await page.getByRole('button', {name: 'Retry', exact: true}).waitFor({state: 'detached'});
  await page.getByRole('button', {name: 'Slow response recovered', exact: true}).waitFor();
  await page.getByRole('tab', {name: 'Opponents', exact: true}).click();
  await page.getByText('Loading opponents…', {exact: true}).waitFor();
  await page.waitForTimeout(250); // Development Strict Mode can remount a newly opened tab.
  const initialRosterReads = opponentReads;
  await page.waitForTimeout(11000);
  assert.equal(opponentReads, initialRosterReads, 'Slow rosters must not be aborted by polling');
  slowRoster = false;
  await Promise.all(opponentPending.splice(0).map(release => release()));
  await page.getByRole('button', {name: 'Patient Rival', exact: true}).click();
  await page.getByText('Loading saved analysis…', {exact: true}).waitFor();
  await page.waitForTimeout(250);
  const initialNotebookReads = notebookReads;
  await page.waitForTimeout(11000);
  assert.equal(notebookReads, initialNotebookReads, 'Slow inline analysis must not be aborted by polling');
  slowNotebook = false;
  await Promise.all(opponentPending.splice(0).map(release => release()));
  await page.getByText('Slow opponent analysis recovered.', {exact: true}).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: workspace error/retry, no hidden polling, slow experiment/roster/analysis responses still render, request deadlines and recovery.');
} finally { await browser.close(); }
