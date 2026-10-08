import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = (await readFile(new URL('../lib/partner/browser-workspace.ts', import.meta.url), 'utf8'))
  .replace('"./screen"', JSON.stringify(new URL('../lib/partner/screen.ts', import.meta.url).href));
const javascript = stripTypeScriptTypes(source, { mode: 'transform' });
const { BrowserWorkspace } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

test('voice workspace navigation works without screen capture and pause fences queued commands', async () => {
  const workspace = new BrowserWorkspace(() => {}, () => {});
  workspace.snapshot = () => JSON.stringify({ targets: [], text: 'Performance' });
  workspace.setControl(true);
  const grant = workspace.grant;
  assert.equal(workspace.context().screenShared, false);
  const look = await workspace.execute({ grant, action: 'look' });
  assert.equal(look.ok, true);
  assert.equal(look.image, undefined);
  assert.match(look.snapshot, /Performance/);
  assert.equal((await workspace.execute({ grant, action: 'clear' })).ok, true);
  workspace.setControl(false);
  assert.equal((await workspace.execute({ grant, action: 'clear' })).ok, false);
  assert.equal(workspace.grant, null);
});

test('pausing navigation preserves a shared screen but revokes mutation permission', async () => {
  const workspace = new BrowserWorkspace(() => {}, () => {});
  let stopped = 0;
  workspace.stream = { getTracks: () => [{ stop() { stopped++; } }] };
  workspace.setControl(true);
  const previous = workspace.grant;
  workspace.setControl(false);
  assert.notEqual(workspace.grant, previous);
  assert.equal(workspace.context().screenShared, true);
  assert.equal((await workspace.execute({ grant: workspace.grant, action: 'clear' })).ok, false);
  workspace.revoke();
  assert.equal(stopped, 1);
  assert.equal(workspace.grant, null);
});
