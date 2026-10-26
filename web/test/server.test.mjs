import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebServer } from '../server.mjs';

test('web server serves SPA routes and forwards exact authenticated commands only to configured upstreams', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'capacity-web-'));
  await writeFile(join(directory, 'index.html'), '<html>workspace</html>');
  t.after(() => rm(directory, { recursive: true, force: true }));
  let seen;
  const upstream = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seen = {
      url: req.url,
      authorization: req.headers.authorization,
      key: req.headers['idempotency-key'],
      body,
    };
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        data: { available: '0.00', acceptingReservations: false },
      }),
    );
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  const app = createWebServer({
    root: directory,
    api: `http://127.0.0.1:${upstream.address().port}`,
    demo: 'http://127.0.0.1:1',
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.address().port}`;
  for (const path of ['/', '/login', '/overview', '/reservations', '/treasury', '/activity']) {
    const result = await fetch(origin + path);
    assert.equal(result.status, 200);
    assert.match(result.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
  assert.equal((await fetch(origin + '/missing.png')).status, 404);
  assert.equal((await fetch(origin + '/.env')).status, 404);
  const reply = await fetch(origin + '/api/v1/programs?perPage=10', {
    method: 'POST',
    headers: {
      authorization: 'Bearer exact',
      'Idempotency-Key': 'stable-key',
      'content-type': 'application/json',
    },
    body: '{"amount":"90071992547409.93"}',
  });
  assert.equal(reply.status, 201);
  assert.deepEqual(seen, {
    url: '/api/v1/programs?perPage=10',
    authorization: 'Bearer exact',
    key: 'stable-key',
    body: '{"amount":"90071992547409.93"}',
  });
  assert.equal((await reply.json()).data.acceptingReservations, false);
  assert.equal((await fetch(origin + '/demo-api/unavailable')).status, 503);
});
