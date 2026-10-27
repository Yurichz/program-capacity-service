import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

test('dashboard read APIs use actual sessions, scoped queries and public representations', async (t) => {
  assert.ok(
    process.env.TEST_DATABASE_URL,
    'Run npm run test:core to provision an isolated TEST_DATABASE_URL',
  );
  const url = new URL(process.env.TEST_DATABASE_URL);

  assert.ok(url.pathname.startsWith('/app_test_'));
  Object.assign(process.env, {
    DATABASE_URL: url.href,
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: randomUUID() + randomUUID(),
    JWT_REFRESH_SECRET: randomUUID() + randomUUID(),
  });
  const { createApplication } = await import('../dist/core/app/create-application.js');
  const { PrismaService } = await import('../dist/core/providers/prisma/prisma.service.js');
  const { ConsumerHealth } =
    await import('../dist/core/providers/kafka/consumer-health.provider.js');
  const app = await createApplication();

  app.useLogger(false);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const origin = await app.getUrl(),
    db = app.get(PrismaService).root;

  app.get(ConsumerHealth).connected = true;
  async function request(path, { token, body, key, method = 'GET' } = {}) {
    const response = await fetch(origin + '/api/v1/' + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    return {
      status: response.status,
      ...(response.status !== 204 ? { body: await response.json() } : {}),
    };
  }
  const suffix = randomUUID(),
    tenantId = `dashboard-${suffix}`,
    id = randomUUID(),
    foreignId = randomUUID();
  const email = `${suffix}@test.dev`,
    password = 'DashboardTest123';
  const user = (
    await request('auth/sign-up', {
      method: 'POST',
      body: { email, password },
    })
  ).body.data;

  await db.user.update({
    where: { id: user.id },
    data: { tenantId, roles: ['USER', 'TREASURY'] },
  });
  const token = (
    await request('auth/sign-in', {
      method: 'POST',
      body: { email, password },
    })
  ).body.data.accessToken;

  await db.program.create({
    data: {
      id,
      tenantId,
      currency: 'USD',
      limitMinor: 9007199254740993n,
      syncStatus: 'READY',
    },
  });
  await db.program.create({
    data: {
      id: foreignId,
      tenantId: `foreign-${suffix}`,
      currency: 'USD',
      limitMinor: 10000n,
    },
  });
  const a = await request(`programs/${id}/reservations`, {
    token,
    method: 'POST',
    key: randomUUID(),
    body: { invoiceId: 'Alpha-1', amount: '12.34', currency: 'USD' },
  });

  assert.equal(a.status, 201);
  const b = await request(`programs/${id}/reservations`, {
    token,
    method: 'POST',
    key: randomUUID(),
    body: { invoiceId: 'Beta-2', amount: '10', currency: 'JPY' },
  });

  assert.equal(b.status, 201);
  await request(`programs/${id}/reservations/${a.body.data.id}/release`, {
    token,
    method: 'POST',
    key: randomUUID(),
    body: {},
  });
  await t.test(
    'program discovery is tenant scoped and retains exact large amounts and false values',
    async () => {
      assert.equal((await request('programs')).status, 401);
      const rows = await request('programs?perPage=1', { token });

      assert.equal(rows.status, 200);
      assert.equal(rows.body.meta.total, 1);
      assert.equal(rows.body.data[0].programId, id);
      assert.equal(rows.body.data[0].limit, '90071992547409.93');
      assert.equal(rows.body.data[0].activeReservationCount, 1);
      assert.equal(rows.body.data[0].overLimit, '0.00');
      assert.ok(!JSON.stringify(rows.body).includes('tenantId'));
      await db.program.update({
        where: { id },
        data: { syncStatus: 'RECONCILIATION_REQUIRED' },
      });
      assert.equal(
        (await request('programs', { token })).body.data[0].acceptingReservations,
        false,
      );
      assert.deepEqual((await request('programs?page=2&perPage=1', { token })).body.data, []);
    },
  );
  await t.test(
    'reservation lists include terminal records, filters, pagination and public FX',
    async () => {
      const rows = await request(`programs/${id}/reservations`, { token });

      assert.equal(rows.body.meta.total, 2);
      assert.deepEqual(
        new Set(rows.body.data.map((r) => r.status)),
        new Set(['ACTIVE', 'RELEASED']),
      );
      const filtered = await request(
        `programs/${id}/reservations?status=RELEASED&currency=USD&invoiceId=alpha`,
        { token },
      );

      assert.equal(filtered.body.meta.total, 1);
      assert.equal(filtered.body.data[0].invoiceId, 'Alpha-1');
      assert.equal(filtered.body.data[0].reservedAmount, '12.34');
      assert.equal(typeof filtered.body.data[0].fx.rate, 'string');
      const empty = await request(`programs/${id}/reservations?currency=KWD`, { token });

      assert.equal(empty.body.meta.lastPage, 1);
      assert.equal(empty.body.meta.next, null);
      for (const query of ['page=0', 'perPage=101', 'status=UNKNOWN', 'currency=XXX', 'extra=true'])
        assert.equal(
          (await request(`programs/${id}/reservations?${query}`, { token })).status,
          422,
        );

      for (const route of [`programs/${foreignId}/reservations`, `programs/${foreignId}/movements`])
        assert.equal((await request(route, { token })).status, 404);
    },
  );
  await t.test(
    'movements are ordered, signed string amounts and omit internal audit identity',
    async () => {
      const rows = await request(`programs/${id}/movements?perPage=2`, {
        token,
      });

      assert.equal(rows.body.meta.total, 3);
      assert.equal(rows.body.data.length, 2);
      assert.equal(rows.body.data[0].reservedDelta, '-12.34');
      assert.ok(BigInt(rows.body.data[0].stateVersion) > BigInt(rows.body.data[1].stateVersion));
      for (const key of ['actor', 'operationId', 'tenantId', 'reservedMinor'])
        assert.ok(!Object.hasOwn(rows.body.data[0], key));
    },
  );
  await t.test(
    'treasury inbox reads enforce permission and redact payload, coordinates and fingerprints',
    async () => {
      const eventId = randomUUID();

      await db.treasuryInbox.create({
        data: {
          id: randomUUID(),
          source: 'local-treasury',
          tenantId,
          programId: id,
          eventId,
          revision: 1n,
          fingerprint: 'secret-fingerprint',
          revisionFingerprint: 'revision-secret',
          topic: 'test',
          partition: 0,
          offset: '0',
          payload: { type: 'ProgramStateSnapshot', private: 'must-not-leak' },
          result: { code: 'APPLIED' },
        },
      });
      const rows = await request(`internal/programs/${id}/treasury-events?eventId=${eventId}`, {
        token,
      });

      assert.equal(rows.status, 200);
      assert.equal(rows.body.meta.total, 1);
      assert.equal(rows.body.data[0].resultCode, 'APPLIED');
      assert.equal(rows.body.data[0].treasuryRevision, '1');
      for (const key of [
        'payload',
        'fingerprint',
        'revisionFingerprint',
        'tenantId',
        'source',
        'offset',
      ])
        assert.ok(!Object.hasOwn(rows.body.data[0], key));

      assert.equal(
        (await request(`internal/programs/${id}/treasury-events?eventId=bad`, { token })).status,
        422,
      );
      await db.user.update({
        where: { id: user.id },
        data: { roles: ['READ_ONLY'] },
      });
      assert.equal(
        (await request(`internal/programs/${id}/treasury-events`, { token })).status,
        403,
      );
      assert.equal((await request('users/me', { token })).status, 200);
      assert.equal(
        (
          await request('users/me', {
            token,
            method: 'PATCH',
            body: { firstName: 'Not allowed' },
          })
        ).status,
        403,
      );
      assert.equal((await request('programs', { token })).status, 200);
      await db.user.update({
        where: { id: user.id },
        data: { roles: ['TREASURY'] },
      });
      assert.equal((await request('users/me', { token })).status, 200);
      await db.user.update({ where: { id: user.id }, data: { roles: [] } });
      assert.equal((await request('programs', { token })).status, 403);
    },
  );
});
