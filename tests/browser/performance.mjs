import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const baseURL = process.env.BROWSER_TEST_URL || 'http://localhost:3000';
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', e => errors.push(e.message));
const leagueId = 'league_ad6dc809-4696-46f5-99a5-fc2b1c58d082';
let scenario = 'normal';
const names = ['Checkmate Club', 'Knight Shift', 'Deep Blueberry', 'Rook & Roll', 'Alice', 'Bishop Please', 'Quiet Storm', 'Endgame Engine', 'Pawn Stars', 'Castle Crew', 'Little Gambit', 'Alice Experimental'];
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  const send = json => route.fulfill({ json });
  if (url.pathname === '/api/session') return send({ email: 'alice@example.com', name: 'Alice', subjectId: 'alice' });
  if (url.pathname === '/api/preferences') return send({ liveCaptions: true });
  if (url.pathname === '/api/views') return send({ views: [] });
  if (url.pathname === '/api/voice/transcripts') return send({ sessions: [] });
  if (url.pathname === '/api/league-overview') {
    let standings = names.map((name, i) => ({ rank: i + 1, player_id: `player-${i}`, player_name: name, policy_label: `gambit:v${i + 1}`, score: scenario === 'equal' ? 0 : .91 - i * .043, score_label: 'Success', score_value_type: 'percent', rounds_played: 94 - i * 3 }));
    if (scenario === 'empty') standings = [];
    if (scenario === 'single') standings = [standings[4]];
    return send({ league: { id: leagueId, name: 'Autumn League', game: { id: 'chess', name: 'Chess' }, url: 'https://softmax.com' }, division: { id: 'competition', name: 'Competition' }, divisions: [{ id: 'competition', name: 'Competition' }], ownPlayers: scenario === 'no-entry' ? [] : ['player-4', 'player-11'], standings, rounds: [], checkedAt: new Date().toISOString() });
  }
  return send({});
});
try {
  await page.goto(`${baseURL}/?league=${leagueId}`);
  const summary = page.getByRole('region', { name: 'League summary' });
  const board = page.getByRole('region', { name: 'Leaderboard', exact: true });
  await summary.getByText('#5', { exact: true }).waitFor();
  await summary.getByText('73.8%', { exact: true }).waitFor();
  await summary.getByText('7 players behind you', { exact: true }).waitFor();
  assert.equal(await board.getByRole('row').count(), 8); // leaders + neighbors + both own entries + header
  const point = board.locator('.performance-chart-point').nth(1);
  await point.focus();
  assert.match(await board.locator('.performance-chart-readout').innerText(), /Knight Shift/);
  await board.getByRole('button', { name: 'All 12 players' }).click();
  assert.equal(await board.getByRole('row').count(), 13);
  await board.getByRole('button', { name: 'Leaders + near you' }).click();
  await page.getByRole('combobox', { name: 'Your league player' }).click();
  await page.getByRole('option', { name: /Alice Experimental/ }).click();
  await summary.getByText('#12', { exact: true }).waitFor();
  assert.match(await board.locator('tr.our-policy').innerText(), /Alice Experimental/);
  await page.getByRole('combobox', { name: 'Your league player' }).click();
  await page.getByRole('option', { name: 'Alice · gambit:v5', exact: true }).click();
  await page.getByRole('heading', { name: 'Performance', exact: true }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: '/tmp/performance-league-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '/tmp/performance-league-mobile.png' });
  for (const state of ['equal', 'single', 'empty', 'no-entry']) {
    scenario = state;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    if (state === 'empty') await board.getByText('The leaderboard is warming up').waitFor();
    else if (state === 'no-entry') await summary.getByText('No ranked entry for this selection yet.').waitFor();
    else await board.locator('.performance-field-chart').waitFor();
    assert.equal(await page.locator('svg [cx="NaN"], svg [cy="NaN"]').count(), 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: rank and percentage score, relative standing, chart keyboard exploration, full leaderboard, own-player selection, mobile, equal scores, one-player and empty/unranked states.');
} finally { await browser.close(); }
