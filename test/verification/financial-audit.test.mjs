import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Logger } from '@nestjs/common';
import { database } from '../../dist/core/providers/prisma/create-database.js';
import { POSTGRES_IMAGE, prisma, testDatabaseUrl, waitFor } from '../../scripts/test-support.mjs';
import { services } from './service-process.mjs';
import { eventSchema } from '../../dist/core/routes/treasury/types/treasury-event.types.js';
import { SignJWT } from 'jose';
import { readFile } from 'node:fs/promises';

let cluster, db, url, capacity, treasury;
const children = [];
const permissions = ['capacity:read', 'reservations:write', 'treasury:reconcile'];
const money = (minor) => `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
const command = (f, amount, invoiceId = randomUUID(), currency = 'USD') => [
  f.principal, f.id, { invoiceId, amount, currency }, randomUUID(), randomUUID(),
];

async function fixture(limit = 100000n) {
  const id = randomUUID(), tenantId = 'audit-' + randomUUID();

  await db.program.create({ data: { id, tenantId, currency: 'USD', limitMinor: limit, syncStatus: 'READY' } });

  return { id, principal: { tenantId, clientId: 'stable-client', permissions } };
}

async function invariant(f, expected, version) {
  const p = await db.program.findUniqueOrThrow({ where: { id: f.id } });
  const rows = await db.reservation.findMany({ where: { programId: f.id, status: 'ACTIVE' } });
  const ledger = await db.capacityMovement.aggregate({ where: { programId: f.id }, _sum: { reservedDelta: true } });

  assert.equal(p.reservedMinor, expected);
  assert.equal(rows.reduce((sum, row) => sum + row.reservedMinor, 0n), expected);
  assert.equal(ledger._sum.reservedDelta ?? 0n, expected);
  if (version !== undefined) assert.equal(p.stateVersion, version);

  const view = await capacity.capacity(f.principal, f.id);

  assert.equal(view.available, money(p.limitMinor > expected ? p.limitMinor - expected : 0n));
  assert.equal(view.overLimit, money(expected > p.limitMinor ? expected - p.limitMinor : 0n));
}

async function worker() {
  const child = fork(new URL('./service-process.mjs', import.meta.url), ['--child'], {
    env: { ...process.env, TEST_DATABASE_URL: url },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });

  children.push(child);
  const ready = await once(child, 'message', { signal: AbortSignal.timeout(15000) });

  assert.equal(ready[0].ready, true);
  const pending = new Map();

  child.on('message', ({ id, value, error }) => {
    const entry = pending.get(id);

    if (!entry) return;

    clearTimeout(entry.timer);
    pending.delete(id);
    if (error) entry.reject(new Error(JSON.stringify(error)));
    else entry.resolve(value);
  });
  child.on('exit', () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Audit worker exited'));
    }

    pending.clear();
  });

  return (method, args) => new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Audit worker command timed out'));
    }, 15000);

    pending.set(id, { resolve, reject, timer });
    child.send({ id, method, args });
  });
}

before(async () => {
  Logger.overrideLogger(false);
  cluster = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase('app_test_audit_' + randomUUID().replaceAll('-', ''))
    .start();
  url = testDatabaseUrl(cluster.getConnectionUri());
  prisma(['migrate', 'deploy'], { ...process.env, DATABASE_URL: url });
  db = database(url);
  ({ capacity, treasury } = services(db));
});

after(async () => {
  for (const child of children) {
    if (child.exitCode !== null) continue;

    child.disconnect();
    try {
      await once(child, 'exit', { signal: AbortSignal.timeout(5000) });
    } catch {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
  }

  await db?.$disconnect();
  await cluster?.stop();
});

test('AUD-CONC-01: two processes queue on a real DB barrier; reserve/replay/release have one effect', { timeout: 45000 }, async () => {
  const [a, b] = await Promise.all([worker(), worker()]);

  for (let attempt = 0; attempt < 5; attempt++) {
    const f = await fixture(100000n);
    let unlock, acquired;
    const locked = new Promise((resolve) => { acquired = resolve; });
    const release = new Promise((resolve) => { unlock = resolve; });
    const barrier = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Program" WHERE id = ${f.id}::uuid FOR UPDATE`;
      acquired();
      await release;
    });

    await locked;
    let outcomes;

    try {
      const operations = [a('reserve', command(f, '700.00')), b('reserve', command(f, '700.00'))];

      outcomes = Promise.all(operations);
      await waitFor(
        () => db.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
        (rows) => rows[0].n >= 2,
        'two independent blocked connections',
        1500,
      );
    } finally {
      unlock();
      await barrier;
    }

    const results = await outcomes;

    assert.deepEqual(results.map((x) => x.status).sort(), [201, 409]);
    await invariant(f, 70000n, 1n);
    const rid = results.find((x) => x.status === 201).body.id;
    const released = await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? a : b)(
      'release', [f.principal, f.id, rid, randomUUID(), randomUUID()],
    )));

    assert.ok(released.every((x) => x.status === 200));
    await invariant(f, 0n, 2n);
    assert.equal(await db.capacityMovement.count({ where: { programId: f.id, reason: 'RELEASE' } }), 1);
  }

  const f = await fixture();
  const args = command(f, '1.00');
  const replay = await Promise.all([a('reserve', args), b('reserve', args)]);

  assert.deepEqual(replay[0], replay[1]);
  await invariant(f, 100n, 1n);
});

test('AUD-CONC-02: locking one program does not block another program', { timeout: 15000 }, async () => {
  const [f, other] = await Promise.all([fixture(), fixture()]);
  const a = await worker();

  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Program" WHERE id = ${f.id}::uuid FOR UPDATE`;
    const result = await a('reserve', command(other, '1.00'));

    assert.equal(result.status, 201);
  }, { timeout: 5000 });
  await invariant(other, 100n, 1n);
  await invariant(f, 0n, 0n);
});

test('AUD-MODEL-01: seeded financial sequences agree with an independent bigint model', { timeout: 45000 }, async (t) => {
  for (const seed of [1, 20261027, 0xdeadbeef]) {
    const f = await fixture();
    let state = seed >>> 0, limit = 100000n, reserved = 0n, version = 0n, revision = 0n;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;

      return state;
    };
    const history = [], active = new Map();

    for (let step = 0; step < 120; step++) {
      const action = next() % 5;

      if (action < 2 || history.length === 0) {
        const amount = BigInt(1 + next() % 50000);
        const currency = next() % 2 ? 'EUR' : 'USD';
        const held = currency === 'EUR' ? (amount * 110n + 99n) / 100n : amount;
        const args = command(f, money(amount), randomUUID(), currency);
        const result = await capacity.reserve(...args);

        if (held <= limit - reserved) {
          assert.equal(result.status, 201, `seed=${seed} step=${step}`);
          assert.equal(result.body.reservedAmount, money(held));
          active.set(result.body.id, held);
          reserved += held;
          version++;
        } else {
          assert.equal(result.body.code, 'INSUFFICIENT_CAPACITY');
        }

        history.push({ args, result: structuredClone(result) });
      } else if (action === 2) {
        const saved = history[next() % history.length];

        assert.deepEqual(await capacity.reserve(...saved.args), saved.result);
      } else if (action === 3 && active.size) {
        const id = [...active.keys()][next() % active.size];
        const result = await capacity.release(f.principal, f.id, id, randomUUID(), randomUUID());

        assert.equal(result.status, 200);
        reserved -= active.get(id);
        active.delete(id);
        version++;
      } else {
        limit = BigInt(next() % 150000);
        revision++;
        const event = {
          eventId: randomUUID(), schemaVersion: 1, type: 'ProgramLimitUpdated',
          tenantId: f.principal.tenantId, programId: f.id, treasuryRevision: revision.toString(),
          occurredAt: new Date().toISOString(), payload: { currency: 'USD', limit: money(limit) },
        };
        const result = await treasury.process(Buffer.from(JSON.stringify(event)), `${event.tenantId}:${f.id}`, {
          topic: 'model-' + seed, partition: 0, offset: String(step),
        });

        assert.equal(result.code, 'APPLIED');
        version++;
      }

      await invariant(f, reserved, version);
    }

    t.diagnostic(`seed=${seed}: 120 operations, model/active sum/ledger/version/availability verified after each operation`);
  }
});

test('AUD-UUID-01: schema-valid uppercase UUID references the same program in a snapshot', async () => {
  const f = await fixture();

  await capacity.reserve(...command(f, '1.00'));
  const view = await capacity.view(f.principal, f.id);
  const event = {
    eventId: randomUUID(),
    schemaVersion: 1,
    type: 'ProgramStateSnapshot',
    tenantId: f.principal.tenantId,
    programId: f.id,
    treasuryRevision: '1',
    occurredAt: new Date().toISOString(),
    payload: {
      currency: view.currency,
      limit: view.limit,
      baseStateVersion: view.stateVersion,
      reservations: view.reservations.map((row) => ({ ...row, programId: f.id.toUpperCase() })),
    },
  };

  assert.equal(eventSchema.safeParse(event).success, true, 'The published schema accepts uppercase UUIDs');
  const result = await treasury.process(Buffer.from(JSON.stringify(event)), `${event.tenantId}:${f.id}`, {
    topic: 'uuid-' + randomUUID(), partition: 0, offset: '0',
  });

  await invariant(f, 100n);
  assert.equal(result.code, 'APPLIED', 'UUID case must not turn the same program into a conflicting program');
});

test('AUD-KAFKA-RISK-02: characterize a malformed high revision followed by lower recovery', async (t) => {
  const f = await fixture();
  const topic = 'revision-' + randomUUID();
  const event = {
    eventId: randomUUID(), schemaVersion: 1, type: 'ProgramLimitUpdated',
    tenantId: f.principal.tenantId, programId: f.id, treasuryRevision: '10',
    occurredAt: new Date().toISOString(), payload: { currency: 'USD', limit: 'invalid' },
  };

  assert.equal((await treasury.process(Buffer.from(JSON.stringify(event)), `${event.tenantId}:${f.id}`, {
    topic, partition: 0, offset: '0',
  })).code, 'INVALID_EVENT');
  const blocked = await db.program.findUniqueOrThrow({ where: { id: f.id } });

  assert.equal(blocked.syncStatus, 'RECONCILIATION_REQUIRED');
  assert.equal(blocked.highestSeenTreasuryRevision, 0n);
  const recovery = {
    ...event, eventId: randomUUID(), type: 'ProgramStateSnapshot', treasuryRevision: '2',
    payload: { currency: 'USD', limit: '1000.00', baseStateVersion: '0', reservations: [] },
  };

  assert.equal((await treasury.process(Buffer.from(JSON.stringify(recovery)), `${event.tenantId}:${f.id}`, {
    topic, partition: 0, offset: '1',
  })).code, 'APPLIED');
  t.diagnostic('Contract question: malformed revision 10 does not raise highestSeen; recovery revision 2 is accepted.');
});

test('AUD-PERF-01: measure bounded hot-program and independent-program workloads', { timeout: 20000 }, async (t) => {
  const results = [];

  for (const programs of [1, 4]) {
    const fixtures = await Promise.all(Array.from({ length: programs }, () => fixture(10000000n)));
    const durations = [];
    let next = 0;
    const started = performance.now();

    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < 48) {
        const i = next++;
        const start = performance.now();

        assert.equal((await capacity.reserve(...command(fixtures[i % programs], '1.00'))).status, 201);
        durations.push(performance.now() - start);
      }
    }));
    const elapsedMs = performance.now() - started;

    durations.sort((a, b) => a - b);
    for (const f of fixtures) await invariant(f, 4800n / BigInt(programs), 48n / BigInt(programs));

    results.push({ programs, concurrency: 4, operations: 48, elapsedMs,
      operationsPerSecond: 48000 / elapsedMs, p95Ms: durations[Math.ceil(0.95 * durations.length) - 1],
      businessRefusals: 0, technicalErrors: 0 });
  }

  await writeFile('.ci-artifacts/verification/load-results.json', JSON.stringify(results, null, 2) + '\n');
  for (const result of results) t.diagnostic(JSON.stringify(result));
});

test('AUD-AUTH-01: nbf/mandatory claims, every protected route, refreshed replay and revoked permissions', async () => {
  process.env.DATABASE_URL = url;
  process.env.JWT_ACCESS_SECRET = randomUUID() + randomUUID();
  process.env.JWT_REFRESH_SECRET = randomUUID() + randomUUID();
  process.env.LOG_LEVEL = 'silent';
  process.env.NODE_ENV = 'test';
  const { createApplication } = await import('../../dist/core/app/create-application.js');
  const { ConsumerHealth } = await import('../../dist/core/providers/kafka/consumer-health.provider.js');
  const { TokenService } = await import('../../dist/core/providers/token/token.service.js');
  const app = await createApplication();

  app.useLogger(false);
  try {
    await app.listen(0, '127.0.0.1');
    app.get(ConsumerHealth).connected = true;
    const origin = await app.getUrl();
    const f = await fixture();
    const user = await db.user.create({ data: {
      email: randomUUID() + '@audit.test', passwordHash: 'fixture-not-used-for-sign-in',
      tenantId: f.principal.tenantId, clientId: f.principal.clientId, roles: ['USER', 'TREASURY'],
    } });
    const sid = randomUUID(), tokens = app.get(TokenService);
    const pair = await tokens.issue(user.id, sid);

    await db.session.create({ data: {
      id: sid, userId: user.id, refreshTokenHash: tokens.hashRefresh(pair.refreshToken),
      expiresAt: new Date(Date.now() + 60000),
    } });
    const send = (path, method = 'GET', token, body, key) => fetch(origin + path, {
      method, signal: AbortSignal.timeout(5000), headers: {
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(key ? { 'idempotency-key': key } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const schema = JSON.parse(await readFile('openapi.json', 'utf8'));
    const publicPaths = ['/api/v1/auth/sign-up', '/api/v1/auth/sign-in', '/api/v1/auth/token/refresh'];

    for (const [path, methods] of Object.entries(schema.paths)) {
      if (publicPaths.includes(path)) continue;

      for (const method of Object.keys(methods)) {
        const concrete = path.replace('{programId}', f.id).replace('{reservationId}', randomUUID());

        assert.equal((await send(concrete, method.toUpperCase())).status, 401, method + ' ' + concrete);
      }
    }

    for (const path of ['/docs', '/docs-json', '/docs-yaml']) assert.equal((await send(path)).status, 401);

    const path = `/api/v1/programs/${f.id}/capacity`;

    assert.equal((await send(path, 'GET', pair.accessToken)).status, 200);
    const claims = {
      sub: String(user.id), sid, jti: randomUUID(), type: 'access',
      iss: process.env.JWT_ISSUER ?? 'capacity-dev', aud: process.env.JWT_AUDIENCE ?? 'capacity-service',
      exp: Math.floor(Date.now() / 1000) + 60,
    };
    const sign = (payload, algorithm = 'HS256') => new SignJWT(payload)
      .setProtectedHeader({ alg: algorithm }).sign(Buffer.from(process.env.JWT_ACCESS_SECRET));

    assert.equal((await send(path, 'GET', await sign({ ...claims, nbf: claims.exp + 60 }))).status, 401);
    for (const field of Object.keys(claims)) {
      const missing = { ...claims };

      delete missing[field];
      assert.equal((await send(path, 'GET', await sign(missing))).status, 401, 'missing ' + field);
    }

    assert.equal((await send(path, 'GET', await sign(claims, 'HS384'))).status, 401);
    const reservePath = `/api/v1/programs/${f.id}/reservations`;
    const body = { invoiceId: randomUUID(), amount: '1.00', currency: 'USD' }, key = randomUUID();
    const first = await send(reservePath, 'POST', pair.accessToken, body, key);

    assert.equal(first.status, 201);
    const original = await first.json();
    const refresh = await send('/api/v1/auth/token/refresh', 'POST', undefined, { refreshToken: pair.refreshToken });

    assert.equal(refresh.status, 200);
    const refreshed = (await refresh.json()).data;
    const replay = await send(reservePath, 'POST', refreshed.accessToken, body, key);

    assert.equal(replay.status, 201);
    assert.deepEqual(await replay.json(), original);
    await db.user.update({ where: { id: user.id }, data: { roles: ['READ_ONLY'] } });
    assert.equal((await send(reservePath, 'POST', refreshed.accessToken, body, key)).status, 403);
    await invariant(f, 100n, 1n);
  } finally {
    await app.close();
  }
});
