import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  databaseErrorContext,
  isTransientDatabaseError,
} from '../dist/helpers/database-error.helpers.js';

test('database diagnostics contain identifiers, never SQL, parameters or credentials', () => {
  const error = Object.assign(new Error('password=private invoice=private SQL=private'), {
    code: 'P2010',
    meta: { driverAdapterError: { cause: { originalCode: '55P03' } } },
  });

  assert.equal(isTransientDatabaseError(error), true);
  assert.deepEqual(databaseErrorContext(error), {
    errorType: 'Error',
    prismaCode: 'P2010',
    sqlState: '55P03',
  });
  assert.doesNotMatch(JSON.stringify(databaseErrorContext(error)), /password|invoice|SQL|private/);
  assert.equal(isTransientDatabaseError(Object.assign(new Error(), { code: '40001' })), true);
  assert.equal(isTransientDatabaseError(Object.assign(new Error(), { code: '23505' })), false);
});

test('shutdown during Kafka connect waits for startup and cannot start a new runner', async () => {
  const { TreasuryConsumer } =
    await import('../dist/core/providers/kafka/treasury-consumer.provider.js');
  const { ConsumerHealth } =
    await import('../dist/core/providers/kafka/consumer-health.provider.js');
  const { pino } = await import('pino');
  let connected, finish;
  const entered = new Promise((resolve) => {
    connected = resolve;
  });
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const calls = [],
    health = new ConsumerHealth();
  const subject = new TreasuryConsumer(
    {
      KAFKA_BROKERS: 'localhost:19092',
      KAFKA_GROUP_ID: 'lifecycle-test',
      KAFKA_TOPIC: 'lifecycle-test',
    },
    { requireReconciliation: async () => undefined },
    health,
    pino({ level: 'silent' }),
  );

  subject.consumer = {
    connect: async () => {
      connected();
      await pending;
      calls.push('connected');
    },
    subscribe: async () => {
      calls.push('subscribe');
    },
    run: async () => {
      calls.push('run');
    },
    stop: async () => {
      calls.push('stop');
    },
    disconnect: async () => {
      calls.push('disconnect');
    },
  };
  const startup = subject.start();

  await entered;
  const shutdown = subject.stop();

  assert.equal(health.connected, false);
  finish();
  await Promise.all([startup, shutdown]);
  assert.deepEqual(calls, ['connected', 'stop', 'disconnect']);
});

test('authenticated readiness, shutdown admission and real PostgreSQL lock timeout', async (t) => {
  assert.ok(
    process.env.TEST_DATABASE_URL,
    'Run npm run test:core to provision an isolated TEST_DATABASE_URL',
  );
  assert.match(new URL(process.env.TEST_DATABASE_URL).pathname, /^\/app_test_/);
  Object.assign(process.env, {
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    JWT_ACCESS_SECRET: randomUUID() + randomUUID(),
    JWT_REFRESH_SECRET: randomUUID() + randomUUID(),
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  });
  const { createApplication } = await import('../dist/core/app/create-application.js');
  const { PrismaService } = await import('../dist/core/providers/prisma/prisma.service.js');
  const { ConsumerHealth } =
    await import('../dist/core/providers/kafka/consumer-health.provider.js');
  const { ApiExceptionFilter } = await import('../dist/filters/api-exception.filter.js');
  const app = await createApplication();

  app.useLogger(false);
  t.after(() => app.close());
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl(),
    prisma = app.get(PrismaService),
    health = app.get(ConsumerHealth);
  const email = randomUUID() + '@operations.test',
    password = randomUUID();
  const send = async (path, body, token) =>
    fetch(origin + '/api/v1/' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  assert.equal((await send('health/ready')).status, 401);
  assert.equal((await send('auth/sign-up', { email, password })).status, 201);
  const {
    data: { accessToken },
  } = await (await send('auth/sign-in', { email, password })).json();

  assert.equal((await send('health', undefined, accessToken)).status, 200);
  assert.equal((await send('health/ready', undefined, accessToken)).status, 503);
  health.connected = true;
  const ready = await send('health/ready', undefined, accessToken);

  assert.equal(ready.status, 200);
  assert.match(ready.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  assert.deepEqual(await ready.json(), { success: true, data: { status: 'ready' } });
  health.stopping = true;
  assert.equal((await send('health/ready', undefined, accessToken)).status, 503);
  health.stopping = false;

  const id = randomUUID();

  await prisma.root.program.create({
    data: { id, tenantId: 'lock-test', currency: 'USD', limitMinor: 100n },
  });
  let unlock, acquired;
  const held = new Promise((resolve) => {
    unlock = resolve;
  });
  const locked = new Promise((resolve) => {
    acquired = resolve;
  });
  const holder = prisma.root.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Program" WHERE "id" = ${id}::uuid FOR UPDATE`;
    acquired();
    await held;
  });
  let failure;

  try {
    await locked;
    await prisma.root
      .$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
        await tx.$queryRaw`SELECT "id" FROM "Program" WHERE "id" = ${id}::uuid FOR UPDATE`;
      })
      .catch((error) => {
        failure = error;
      });
  } finally {
    unlock();
    await holder;
  }

  assert.ok(failure, 'Conflicting lock must fail');
  assert.equal(databaseErrorContext(failure).sqlState, '55P03');
  assert.equal(isTransientDatabaseError(failure), true);
  let status, body;
  const response = {
    status(value) {
      status = value;

      return this;
    },
    json(value) {
      body = value;
    },
  };

  new ApiExceptionFilter().catch(failure, {
    switchToHttp: () => ({
      getRequest: () => ({ id: randomUUID(), method: 'POST' }),
      getResponse: () => response,
    }),
  });
  assert.equal(status, 503);
  assert.equal(body.error.code, 503000);
  assert.doesNotMatch(JSON.stringify(body), /SELECT|Program|Prisma|55P03/);
});
