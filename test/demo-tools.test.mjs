import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createDemoServer } from '../scripts/demo-tools.mjs';

test('demo publisher verifies core resource access, bounds payloads and preserves exact event identity', async (t) => {
  let authChecks = 0,
    published = [],
    failing = false;
  const core = createServer((req, res) => {
    authChecks++;
    const status = req.headers.authorization === 'Bearer permitted' ? 200 : 403;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(
        status === 200
          ? { success: true, data: {} }
          : { success: false, error: { code: 403000, message: 'Forbidden' } },
      ),
    );
  });
  await new Promise((resolve) => core.listen(0, '127.0.0.1', resolve));
  t.after(() => core.close());
  const id = '11111111-1111-4111-8111-111111111111';
  const app = createDemoServer({
    enabled: true,
    apiUrl: `http://127.0.0.1:${core.address().port}`,
    topic: 'test',
    producer: {
      send: async (value) => {
        if (failing) throw new Error('private infrastructure detail');
        published.push(value);
      },
    },
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.address().port}`,
    event = {
      schemaVersion: 1,
      eventId: randomUUID(),
      type: 'ProgramLimitUpdated',
      tenantId: 'demo-tenant',
      programId: id,
      treasuryRevision: '1',
      occurredAt: new Date().toISOString(),
      payload: { currency: 'USD', limit: '0.00' },
    };
  const post = (body = event, authorization = 'Bearer permitted') =>
    fetch(`${origin}/demo-api/programs/${id}/events`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  assert.equal((await post(event, '')).status, 401);
  assert.equal(authChecks, 0);
  assert.equal((await post(event, 'Bearer forbidden')).status, 403);
  assert.equal(published.length, 0);
  assert.equal((await post({ ...event, tenantId: 'foreign' })).status, 422);
  assert.equal((await post({ ...event, programId: randomUUID() })).status, 422);
  assert.equal((await post('{broken')).status, 422);
  assert.equal((await post('x'.repeat(2 * 1024 * 1024 + 1))).status, 413);
  const accepted = await post();
  assert.equal(accepted.status, 202);
  assert.deepEqual((await accepted.json()).data, {
    eventId: event.eventId,
    status: 'Published',
  });
  assert.deepEqual(JSON.parse(published[0].messages[0].value), event);
  assert.equal(published[0].messages[0].key, `demo-tenant:${id}`);
  await post();
  assert.equal(published[0].messages[0].value, published[1].messages[0].value);
  failing = true;
  const failed = await post();
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes('private infrastructure'));
  const disabled = createDemoServer({ enabled: false });
  await new Promise((resolve) => disabled.listen(0, '127.0.0.1', resolve));
  t.after(() => disabled.close());
  assert.equal(
    (await fetch(`http://127.0.0.1:${disabled.address().port}/demo-api/programs/${id}/config`))
      .status,
    404,
  );
});
