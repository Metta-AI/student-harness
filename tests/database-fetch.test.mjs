import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { withDatabaseReadTimeout } from '../lib/database-fetch.ts';

test('database reads have deadlines, including stalled response bodies, and preserve caller cancellation', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/body') { response.writeHead(200); response.write('{'); }
    if (request.url === '/ok') response.end('ok');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const bounded = withDatabaseReadTimeout(fetch, 150);
  try {
    assert.equal(await (await bounded(`${url}/ok`)).text(), 'ok');
    await assert.rejects(bounded(`${url}/stalled`), { name: 'AbortError', message: 'Database read timed out. Please retry.' });
    const response = await bounded(`${url}/body`);
    await assert.rejects(response.text(), error => ['TimeoutError', 'AbortError'].includes(error.name));
    for (const requestInput of [false, true]) {
      const controller = new AbortController();
      const pending = requestInput
        ? bounded(new Request(`${url}/stalled`, { signal: controller.signal }))
        : bounded(`${url}/stalled`, { signal: controller.signal });
      controller.abort();
      await assert.rejects(pending, { name: 'AbortError', message: 'Database read canceled.' });
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('database mutation requests retain their original signals and options', async () => {
  const controller = new AbortController();
  const options = { method: 'POST', body: '{}', signal: controller.signal };
  const input = new Request('https://database.invalid/rest/v1/table', options);
  const seen = [];
  const bounded = withDatabaseReadTimeout(async (...args) => { seen.push(args); return new Response('ok'); }, 1);
  await bounded(input);
  await bounded(input.url, options);
  assert.equal(seen[0][0], input);
  assert.equal(seen[0][1], undefined);
  assert.equal(seen[1][1], options);
  assert.equal(controller.signal.aborted, false);
});
