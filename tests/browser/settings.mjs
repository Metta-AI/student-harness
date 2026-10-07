import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const baseURL = process.env.BROWSER_TEST_URL || 'http://localhost:3000';
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
let preferences = { preferredName: '', voice: 'marin', responseLength: 'balanced', reasoningEffort: 'low', liveCaptions: true };
let failSave = false, signedIn = true, lastPatch;
const errors = []; page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/session', route => route.fulfill({ json: { email: signedIn ? 'aaron@example.test' : null, name: 'Aaron Landy' } }));
await page.route('**/api/preferences', route => {
  if (!signedIn) return route.fulfill({ status: 401, json: { error: 'Sign in first' } });
  if (route.request().method() === 'POST') {
    if (failSave) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    lastPatch = route.request().postDataJSON(); preferences = { ...preferences, ...lastPatch };
  }
  return route.fulfill({ json: preferences });
});
try {
  await page.goto(`${baseURL}/settings`);
  await page.getByLabel('Preferred name').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Save changes' }).isEnabled(), false);
  await page.getByLabel('Preferred name').fill('Aaron');
  await page.getByLabel('Voice', { exact: true }).selectOption('vesper');
  await page.getByLabel('Response length').selectOption('detailed');
  await page.getByLabel('Chat reasoning').selectOption('high');
  await page.getByRole('switch', { name: 'Live captions' }).uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Settings saved.', { exact: true }).waitFor();
  assert.deepEqual(preferences, { preferredName: 'Aaron', voice: 'vesper', responseLength: 'detailed', reasoningEffort: 'high', liveCaptions: false });
  await page.reload(); await page.getByLabel('Preferred name').waitFor();
  assert.equal(await page.getByLabel('Voice', { exact: true }).inputValue(), 'vesper');
  assert.equal(await page.getByRole('switch', { name: 'Live captions' }).isChecked(), false);
  failSave = true;
  await page.getByLabel('Voice', { exact: true }).selectOption('willow');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByLabel('Voice', { exact: true }).inputValue(), 'willow');
  failSave = false;
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Settings saved.', { exact: true }).waitFor();
  assert.deepEqual(lastPatch, { voice: 'willow' });
  await page.screenshot({ path: '/tmp/preston-settings-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByLabel('Chat reasoning').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/preston-settings-mobile-bottom.png' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '/tmp/preston-settings-mobile.png' });
  await page.getByRole('button', { name: 'Restore defaults' }).click();
  assert.equal(await page.getByLabel('Voice', { exact: true }).inputValue(), 'marin');
  assert.equal(preferences.voice, 'willow', 'reset requires saving');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Settings saved.', { exact: true }).waitFor();
  signedIn = false; await page.reload(); await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Preferred name').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Settings browser checks passed: save/reload, partial updates, retry, defaults, mobile, signed out.');
} finally { await browser.close(); }
