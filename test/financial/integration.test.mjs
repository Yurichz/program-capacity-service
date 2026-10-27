import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, getContainerRuntimeClient } from 'testcontainers';
import { generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { Kafka, logLevel } from 'kafkajs';
import { pino } from 'pino';
import { database, prismaFor } from '../../dist/core/providers/prisma/create-database.js';
import { CapacityService } from '../../dist/core/routes/capacity/layers/capacity-bl/capacity.service.js';
import { ConsumerHealth } from '../../dist/core/providers/kafka/consumer-health.provider.js';
import { FxRateProvider } from '../../dist/core/providers/fx/fx-rate.provider.js';
import { TreasuryService } from '../../dist/core/routes/treasury/layers/treasury-bl/treasury.service.js';
import { DIRECTION, MAX_EVENT_BYTES, fingerprint } from '../../dist/helpers/capacity.helpers.js';
import { TreasuryConsumer } from '../../dist/core/providers/kafka/treasury-consumer.provider.js';

import { validateEnvironment } from '../../dist/config/environment.config.js';
import { ConfigService } from '@nestjs/config';
import { CapacityRepository } from '../../dist/core/routes/capacity/layers/capacity-da/capacity.repository.js';
import { CapacityClService } from '../../dist/core/routes/capacity/layers/capacity-cl/capacity-cl.service.js';
import { TreasuryClService } from '../../dist/core/routes/treasury/layers/treasury-cl/treasury-cl.service.js';
import { TreasuryRepository } from '../../dist/core/routes/treasury/layers/treasury-da/treasury.repository.js';
import { FinancialTransactionService } from '../../dist/core/providers/prisma/financial-transaction.service.js';

function testSettings(input) {
  return validateEnvironment({
    JWT_ACCESS_SECRET: 'access-test-secret-'.repeat(4),
    JWT_REFRESH_SECRET: 'refresh-test-secret-'.repeat(4),
    ...input,
  });
}
function makeCapacity(client, health, fx = new FxRateProvider()) {
  const prisma = prismaFor(client),
    repo = new CapacityRepository(prisma);
  const cl = new CapacityClService(
    repo,
    health,
    fx,
    new FinancialTransactionService(prisma),
    prisma,
  );

  return new CapacityService(repo, health, cl);
}
function makeTreasury(client, source) {
  const prisma = prismaFor(client),
    settings = new ConfigService({ TREASURY_SOURCE: source });
  const repo = new CapacityRepository(prisma),
    transactions = new FinancialTransactionService(prisma);
  const capacity = new CapacityClService(
    repo,
    new ConsumerHealth(),
    new FxRateProvider(),
    transactions,
    prisma,
  );

  return new TreasuryService(
    new TreasuryClService(repo, new TreasuryRepository(prisma, settings), transactions, settings),
    capacity,
  );
}
async function makeApplication(settings, client, health) {
  Object.assign(
    process.env,
    Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, String(value)])),
  );
  const { Test } = await import('@nestjs/testing');
  const { AppModule } = await import('../../dist/core/app/app.module.js');
  const { PrismaService } = await import('../../dist/core/providers/prisma/prisma.service.js');
  const { configureApplication } = await import('../../dist/core/app/create-application.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prismaFor(client))
    .overrideProvider(ConfigService)
    .useValue(new ConfigService(settings))
    .overrideProvider(ConsumerHealth)
    .useValue(health)
    .compile();
  const app = configureApplication(module.createNestApplication({ logger: false }));

  await app.init();

  return app;
}

const POSTGRES_IMAGE =
  'postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3';
const KAFKA_IMAGE =
  'apache/kafka:4.1.1@sha256:0bc1bb2478f45b6cea78864df86acdc11e8df2c5172477819a4d12942cbe5d40';
let postgres;
let broker;
let db;
let secondDb;
let url;
let brokers;
let producer;
let admin;
let scratch;

async function poll(read, accept, timeout = 20000) {
  const end = Date.now() + timeout;

  while (Date.now() < end) {
    const value = await read();

    if (accept(value)) return value;

    await setTimeout(30);
  }

  throw new Error('Bounded polling timed out');
}
async function fixture(limit = 10000n) {
  const id = randomUUID(),
    tenantId = `tenant-${randomUUID()}`;

  await db.program.create({
    data: { id, tenantId, currency: 'USD', limitMinor: limit, syncStatus: 'READY' },
  });
  const principal = {
    tenantId,
    clientId: 'test-client',
    permissions: ['capacity:read', 'reservations:write', 'treasury:reconcile'],
  };
  const health = new ConsumerHealth();

  health.connected = true;

  return {
    id,
    principal,
    health,
    service: makeCapacity(db, health),
    treasury: makeTreasury(db, 'test-treasury'),
  };
}
const input = (amount = '70.00', currency = 'USD', invoiceId = randomUUID()) => ({
  amount,
  currency,
  invoiceId,
});
const key = () => randomUUID();

function rendezvous(parties) {
  let arrived = 0;
  let release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });

  return async () => {
    if (++arrived === parties) release();

    await ready;
  };
}
async function assertAggregate(id) {
  const p = await db.program.findUniqueOrThrow({ where: { id } });
  const active = await db.reservation.aggregate({
    where: { programId: id, status: 'ACTIVE' },
    _sum: { reservedMinor: true },
  });

  expect(p.reservedMinor).toBe(active._sum.reservedMinor ?? 0n);
  const audit = await db.capacityMovement.aggregate({
    where: { programId: id },
    _sum: { reservedDelta: true },
  });

  expect(p.reservedMinor).toBe(audit._sum.reservedDelta ?? 0n);
}
function event(f, revision, type, payload) {
  return {
    eventId: randomUUID(),
    schemaVersion: 1,
    type,
    tenantId: f.principal.tenantId,
    programId: f.id,
    treasuryRevision: revision,
    occurredAt: new Date().toISOString(),
    payload,
  };
}
async function apply(f, e, offset = key()) {
  return f.treasury.process(Buffer.from(JSON.stringify(e)), `${e.tenantId}:${e.programId}`, {
    topic: 'unit-integration',
    partition: 0,
    offset,
  });
}
async function snapshot(f, revision) {
  const v = await f.service.view(f.principal, f.id);

  return event(
    f,
    revision ?? (BigInt(v.highestSeenTreasuryRevision) + 1n).toString(),
    'ProgramStateSnapshot',
    {
      currency: v.currency,
      limit: v.limit,
      baseStateVersion: v.stateVersion,
      reservations: v.reservations,
    },
  );
}
beforeAll(async () => {
  // No supplied DATABASE_URL is ever used: this suite owns the entire disposable DB.
  postgres = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase('app_test_capacity')
    .withUsername('test')
    .withPassword('test')
    .start();
  url = postgres.getConnectionUri();
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  db = database(url);
  secondDb = database(url);
  scratch = await mkdtemp(join(tmpdir(), 'capacity-tests-'));
  broker = await new GenericContainer(KAFKA_IMAGE)
    .withExposedPorts(9092)
    .withEnvironment({
      KAFKA_NODE_ID: '1',
      KAFKA_PROCESS_ROLES: 'broker,controller',
      KAFKA_LISTENERS: 'PLAINTEXT://:9092,CONTROLLER://:9093',
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: 'PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT',
      KAFKA_CONTROLLER_LISTENER_NAMES: 'CONTROLLER',
      KAFKA_CONTROLLER_QUORUM_VOTERS: '1@localhost:9093',
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: '1',
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: '0',
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: '1',
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: '1',
      CLUSTER_ID: 'MkU3OEVBNTcwNTJENDM2Qk',
    })
    .withEntrypoint(['sh', '-c'])
    .withCommand([
      'echo WAITING_FOR_TEST_SCRIPT; while [ ! -f /tmp/start.sh ]; do sleep 0.1; done; exec sh /tmp/start.sh',
    ])
    .withWaitStrategy(Wait.forLogMessage('WAITING_FOR_TEST_SCRIPT'))
    .start();
  brokers = [`${broker.getHost()}:${broker.getMappedPort(9092)}`];
  await broker.copyContentToContainer([
    {
      target: '/tmp/start.sh',
      content: `export KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://${brokers[0]}\nexec /etc/kafka/docker/run\n`,
    },
  ]);
  const kafka = new Kafka({
    clientId: 'integration',
    brokers,
    logLevel: logLevel.NOTHING,
    retry: { retries: 20, initialRetryTime: 100 },
  });

  admin = kafka.admin();
  await admin.connect();
  producer = kafka.producer();
  await producer.connect();
}, 180000);
afterAll(async () => {
  await producer?.disconnect();
  await admin?.disconnect();
  await db?.$disconnect();
  await secondDb?.$disconnect();
  await broker?.stop();
  await postgres?.stop();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});
describe('PostgreSQL financial concurrency', () => {
  test('shutdown rejects new financial writes without persisting a refusal or financial effect', async () => {
    const f = await fixture();
    const r = await f.service.reserve(f.principal, f.id, input('1'), key(), key());
    const count = await db.idempotencyRequest.count({ where: { tenantId: f.principal.tenantId } });

    f.health.stopping = true;
    await expect(
      f.service.reserve(f.principal, f.id, input('1'), key(), key()),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      f.service.release(f.principal, f.id, r.body.id, key(), key()),
    ).rejects.toMatchObject({ status: 503 });
    expect(await db.idempotencyRequest.count({ where: { tenantId: f.principal.tenantId } })).toBe(
      count,
    );
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.body.id } })).status).toBe(
      'ACTIVE',
    );
    await assertAggregate(f.id);
  });
  test('independent clients: concurrent 70 + 70 against 100 admits one; refusal replays after capacity changes', async () => {
    const f = await fixture();
    const other = makeCapacity(secondDb, f.health);
    const meet = rendezvous(2);

    for (const service of [f.service, other]) {
      const lock = service.repository.lock.bind(service.repository);

      service.repository.lock = async (...args) => {
        await meet();

        return lock(...args);
      };
    }

    const keys = [key(), key()];
    const commands = [input(), input()];
    const results = await Promise.all([
      f.service.reserve(f.principal, f.id, commands[0], keys[0], key()),
      other.reserve(f.principal, f.id, commands[1], keys[1], key()),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.capacityMovement.count({ where: { programId: f.id } })).toBe(1);
    const winner = results.find((r) => r.status === 201);

    await f.service.release(f.principal, f.id, winner.body.id, key(), key());
    const loser = results.findIndex((r) => r.status === 409);

    expect(await f.service.reserve(f.principal, f.id, commands[loser], keys[loser], key())).toEqual(
      results[loser],
    );
    await assertAggregate(f.id);
  });
  test('same key has one effect, normalized amounts replay; altered key payload conflicts; cross-program invoice uniqueness', async () => {
    const f = await fixture();
    const k = key();
    const i = input('10.0');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => f.service.reserve(f.principal, f.id, i, k, key())),
    );

    for (const result of results) expect(result).toEqual(results[0]);

    expect(await f.service.reserve(f.principal, f.id, { ...i, amount: '10.00' }, k, key())).toEqual(
      results[0],
    );
    await expect(
      f.service.reserve(f.principal, f.id, { ...i, amount: '11' }, k, key()),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    const pid = randomUUID();

    await db.program.create({
      data: {
        id: pid,
        tenantId: f.principal.tenantId,
        currency: 'USD',
        limitMinor: 10000n,
        syncStatus: 'READY',
      },
    });
    expect((await f.service.reserve(f.principal, pid, i, key(), key())).body.code).toBe(
      'DUPLICATE_INVOICE',
    );
    const rid = results[0].body.id;

    await Promise.all([
      f.service.release(f.principal, f.id, rid, key(), key()),
      f.service.release(f.principal, f.id, rid, key(), key()),
    ]);
    expect((await f.service.reserve(f.principal, f.id, i, key(), key())).body.code).toBe(
      'DUPLICATE_INVOICE',
    );
    expect(await db.capacityMovement.count({ where: { programId: f.id, reason: 'RELEASE' } })).toBe(
      1,
    );
    await assertAggregate(f.id);
  });
  test('concurrent cross-program invoices with different keys produce exactly one reservation', async () => {
    const f = await fixture();
    const pid = randomUUID();

    await db.program.create({
      data: {
        id: pid,
        tenantId: f.principal.tenantId,
        currency: 'USD',
        limitMinor: 10000n,
        syncStatus: 'READY',
      },
    });
    const i = input('10');
    const results = await Promise.all([
      f.service.reserve(f.principal, f.id, i, key(), key()),
      makeCapacity(secondDb, f.health).reserve(f.principal, pid, i, key(), key()),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await db.reservation.count({
        where: { tenantId: f.principal.tenantId, invoiceId: i.invoiceId },
      }),
    ).toBe(1);
    await assertAggregate(f.id);
    await assertAggregate(pid);
  });
  test('failed audit rolls back reservation, aggregate and idempotency; lost HTTP response replays', async () => {
    const f = await fixture();
    const k = key(),
      i = input('10');
    const original = f.service.repository.movement.bind(f.service.repository);

    f.service.repository.movement = async () => {
      throw new Error('Injected failure after financial writes');
    };
    await expect(f.service.reserve(f.principal, f.id, i, k, key())).rejects.toThrow('Injected');
    expect(await db.reservation.count({ where: { programId: f.id } })).toBe(0);
    expect(await db.idempotencyRequest.count({ where: { tenantId: f.principal.tenantId } })).toBe(
      0,
    );
    expect((await db.program.findUniqueOrThrow({ where: { id: f.id } })).stateVersion).toBe(0n);
    await assertAggregate(f.id);
    f.service.repository.movement = original;
    const committed = await f.service.reserve(f.principal, f.id, i, k, key());

    expect(await f.service.reserve(f.principal, f.id, i, k, key())).toEqual(committed);
  });
  test('FX is fixed; release and replay survive provider failure, including scale 0 and 3', async () => {
    const f = await fixture();
    const fx = new FxRateProvider();
    const service = makeCapacity(db, f.health, fx);

    for (const [amount, currency, expected] of [
      ['100', 'JPY', '0.67'],
      ['1.001', 'KWD', '3.26'],
      ['1.00', 'EUR', '1.10'],
    ]) {
      const i = input(amount, currency),
        k = key();
      const reserved = await service.reserve(f.principal, f.id, i, k, key());

      expect(reserved.body.reservedAmount).toBe(expected);
      const spy = jest.spyOn(fx, 'quote').mockRejectedValue(new Error('FX down'));

      expect(await service.reserve(f.principal, f.id, i, k, key())).toEqual(reserved);
      expect(
        (await service.release(f.principal, f.id, reserved.body.id, key(), key())).body
          .reservedAmount,
      ).toBe(expected);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }

    await assertAggregate(f.id);
  });
  test('identity FX does not call the provider; expired external FX leaves no idempotency record', async () => {
    const f = await fixture();
    const fx = new FxRateProvider();
    const service = makeCapacity(db, f.health, fx);
    const spy = jest.spyOn(fx, 'quote').mockRejectedValue(new Error('Provider unavailable'));

    expect((await service.reserve(f.principal, f.id, input('1'), key(), key())).status).toBe(201);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    const k = key();

    jest.spyOn(fx, 'quote').mockResolvedValue({
      rate: '1.1',
      source: 'fixture',
      direction: 'PROGRAM_MAJOR_PER_INVOICE_MAJOR',
      asOf: new Date(Date.now() - 60001),
    });
    await expect(
      service.reserve(f.principal, f.id, input('1', 'EUR'), k, key()),
    ).rejects.toMatchObject({ code: 'FX_UNAVAILABLE' });
    expect(
      await db.idempotencyRequest.count({ where: { tenantId: f.principal.tenantId, key: k } }),
    ).toBe(0);
    await assertAggregate(f.id);
  });
  test('lower treasury limit exposes overLimit; release works while reconciliation or consumer is unavailable', async () => {
    const f = await fixture();
    const r = await f.service.reserve(f.principal, f.id, input(), key(), key());

    expect(
      (await apply(f, event(f, '1', 'ProgramLimitUpdated', { currency: 'USD', limit: '50' }))).code,
    ).toBe('APPLIED');
    expect(await f.service.capacity(f.principal, f.id)).toMatchObject({
      available: '0.00',
      overLimit: '20.00',
      acceptingReservations: false,
    });
    expect((await f.service.reserve(f.principal, f.id, input('1'), key(), key())).body.code).toBe(
      'INSUFFICIENT_CAPACITY',
    );
    f.health.connected = false;
    await f.treasury.requireReconciliation();
    expect((await f.service.release(f.principal, f.id, r.body.id, key(), key())).status).toBe(200);
    await assertAggregate(f.id);
  });
  test('reserve/release and reserve/snapshot races preserve aggregates', async () => {
    const f = await fixture();
    const r = await f.service.reserve(f.principal, f.id, input('20'), key(), key());

    await Promise.all([
      f.service.release(f.principal, f.id, r.body.id, key(), key()),
      f.service.reserve(f.principal, f.id, input('30'), key(), key()),
    ]);
    const snap = await snapshot(f);
    const results = await Promise.all([
      f.service.reserve(f.principal, f.id, input('1'), key(), key()),
      apply(f, snap),
    ]);

    expect(['APPLIED', 'STATE_VERSION_CONFLICT']).toContain(results[1].code);
    await assertAggregate(f.id);
  });
});
describe('treasury reconciliation and deduplication', () => {
  test.each([false, true])(
    'snapshot accepts uppercase reservation UUIDs with uppercase program UUIDs: %s, retaining replay fingerprints',
    async (uppercaseProgram) => {
      const f = await fixture();
      const r = await f.service.reserve(f.principal, f.id, input('1'), key(), key());
      const original = await db.reservation.findUniqueOrThrow({ where: { id: r.body.id } });
      const e = await snapshot(f);

      e.payload.reservations = e.payload.reservations.map((row) => ({
        ...row,
        id: row.id.toUpperCase(),
        programId: uppercaseProgram ? row.programId.toUpperCase() : row.programId,
      }));
      expect((await apply(f, e)).code).toBe('APPLIED');
      const applied = await db.program.findUniqueOrThrow({ where: { id: f.id } });

      expect(applied).toMatchObject({
        syncStatus: 'READY', reservedMinor: 100n, stateVersion: 2n, lastAppliedTreasuryRevision: 1n,
      });
      const inbox = await db.treasuryInbox.findUniqueOrThrow({
        where: { source_eventId: { source: 'test-treasury', eventId: e.eventId } },
      });

      expect(inbox.payload).toEqual(e);
      expect(inbox.fingerprint).toBe(fingerprint(e));
      expect(inbox.revisionFingerprint).toBe(fingerprint({
        type: e.type,
        tenantId: e.tenantId,
        programId: e.programId,
        revision: e.treasuryRevision,
        payload: e.payload,
      }));
      expect((await apply(f, e)).code).toBe('APPLIED');
      expect(await db.program.findUniqueOrThrow({ where: { id: f.id } })).toEqual(applied);
      expect(await db.reservation.findUniqueOrThrow({ where: { id: r.body.id } })).toEqual(original);
      expect(await db.reservation.count({ where: { programId: f.id } })).toBe(1);
      expect(await db.capacityMovement.count({ where: { programId: f.id } })).toBe(2);
      await assertAggregate(f.id);
      expect((await f.service.reserve(f.principal, f.id, input('1'), key(), key())).status).toBe(201);
      await assertAggregate(f.id);
    },
  );
  test('snapshot restores uppercase UUIDs and keeps case-distinct invoice IDs separate', async () => {
    const f = await fixture();

    await f.service.reserve(f.principal, f.id, input('1', 'USD', 'Invoice-Case'), key(), key());
    const e = await snapshot(f);
    const id = key().toUpperCase();

    e.payload.reservations.push({
      ...e.payload.reservations[0], id, programId: f.id.toUpperCase(), invoiceId: 'INVOICE-CASE',
    });
    expect((await apply(f, e)).code).toBe('APPLIED');
    expect(await db.reservation.findUniqueOrThrow({ where: { id } })).toMatchObject({
      id: id.toLowerCase(), programId: f.id, invoiceId: 'INVOICE-CASE', status: 'ACTIVE', reservedMinor: 100n,
    });
    expect(await db.reservation.count({ where: { programId: f.id, status: 'ACTIVE' } })).toBe(2);
    expect(await db.program.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({
      syncStatus: 'READY', reservedMinor: 200n, stateVersion: 2n,
    });
    await assertAggregate(f.id);
  });
  test('snapshot rejects duplicate reservation UUIDs in different cases before financial changes', async () => {
    const f = await fixture();
    const r = await f.service.reserve(f.principal, f.id, input('1'), key(), key());
    const original = await db.reservation.findUniqueOrThrow({ where: { id: r.body.id } });
    const e = await snapshot(f);

    e.payload.reservations.push({ ...e.payload.reservations[0], id: r.body.id.toUpperCase(), invoiceId: key() });
    expect((await apply(f, e)).code).toBe('DUPLICATE_SNAPSHOT_ROW');
    expect(await db.program.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({
      syncStatus: 'RECONCILIATION_REQUIRED', reservedMinor: 100n, stateVersion: 1n, lastAppliedTreasuryRevision: 0n,
    });
    expect(await db.reservation.findUniqueOrThrow({ where: { id: r.body.id } })).toEqual(original);
    expect(await db.capacityMovement.count({ where: { programId: f.id } })).toBe(1);
    await assertAggregate(f.id);
  });
  test.each([false, true])('snapshot rejects a different program UUID, uppercase: %s', async (uppercaseProgram) => {
    const f = await fixture();
    const foreign = await db.program.create({
      data: { id: key(), tenantId: f.principal.tenantId, currency: 'USD', limitMinor: 10000n, syncStatus: 'READY' },
    });
    const r = await f.service.reserve(f.principal, f.id, input('1'), key(), key());
    const original = await db.reservation.findUniqueOrThrow({ where: { id: r.body.id } });
    const e = await snapshot(f);

    e.payload.reservations[0].programId = uppercaseProgram ? foreign.id.toUpperCase() : foreign.id;
    expect((await apply(f, e)).code).toBe('CURRENCY_OR_PROGRAM_CONFLICT');
    expect(await db.program.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({
      syncStatus: 'RECONCILIATION_REQUIRED', reservedMinor: 100n, stateVersion: 1n, lastAppliedTreasuryRevision: 0n,
    });
    expect(await db.program.findUniqueOrThrow({ where: { id: foreign.id } })).toEqual(foreign);
    expect(await db.reservation.findUniqueOrThrow({ where: { id: r.body.id } })).toEqual(original);
    expect(await db.capacityMovement.count({ where: { programId: f.id } })).toBe(1);
    await assertAggregate(f.id);
  });
  test('snapshot keeps existing invoice IDs case-sensitive', async () => {
    const f = await fixture();
    const r = await f.service.reserve(f.principal, f.id, input('1', 'USD', 'Invoice-Case'), key(), key());
    const original = await db.reservation.findUniqueOrThrow({ where: { id: r.body.id } });
    const e = await snapshot(f);

    e.payload.reservations[0].invoiceId = 'INVOICE-CASE';
    expect((await apply(f, e)).code).toBe('RESERVATION_CONFLICT');
    expect(await db.program.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({
      syncStatus: 'RECONCILIATION_REQUIRED', reservedMinor: 100n, stateVersion: 1n, lastAppliedTreasuryRevision: 0n,
    });
    expect(await db.reservation.findUniqueOrThrow({ where: { id: r.body.id } })).toEqual(original);
    expect(await db.capacityMovement.count({ where: { programId: f.id } })).toBe(1);
    await assertAggregate(f.id);
  });
  test('snapshot keeps tenant IDs case-sensitive with a matching partition key', async () => {
    const f = await fixture();
    const r = await f.service.reserve(f.principal, f.id, input('1'), key(), key());
    const original = await db.reservation.findUniqueOrThrow({ where: { id: r.body.id } });
    const program = await db.program.findUniqueOrThrow({ where: { id: f.id } });
    const e = await snapshot(f);

    e.tenantId = e.tenantId.toUpperCase();
    expect((await apply(f, e)).code).toBe('UNKNOWN_PROGRAM');
    expect(await db.program.findUniqueOrThrow({ where: { id: f.id } })).toEqual(program);
    expect(await db.reservation.findUniqueOrThrow({ where: { id: r.body.id } })).toEqual(original);
    expect(await db.capacityMovement.count({ where: { programId: f.id } })).toBe(1);
    await assertAggregate(f.id);
  });
  test('event replay, conflicting event ID and malformed quarantine have no repeated financial effect', async () => {
    const f = await fixture();
    const e = event(f, '1', 'ProgramLimitUpdated', { currency: 'USD', limit: '150' });

    expect((await apply(f, e)).code).toBe('APPLIED');
    expect((await apply(f, e)).code).toBe('APPLIED');
    expect(await db.capacityMovement.count({ where: { programId: f.id } })).toBe(1);
    expect((await apply(f, { ...e, payload: { currency: 'USD', limit: '200' } })).code).toBe(
      'EVENT_ID_CONFLICT',
    );
    expect((await db.program.findUniqueOrThrow({ where: { id: f.id } })).syncStatus).toBe(
      'RECONCILIATION_REQUIRED',
    );
    await apply(f, { ...e, treasuryRevision: '9' });
    expect(
      (await db.program.findUniqueOrThrow({ where: { id: f.id } })).highestSeenTreasuryRevision,
    ).toBe(9n);
    const coords = { topic: 'bad', partition: 0, offset: '0' };

    await f.treasury.process(Buffer.from('{bad'), null, coords);
    await f.treasury.process(Buffer.from('{bad'), null, coords);
    expect(await db.treasuryQuarantine.count({ where: { topic: 'bad', offset: '0' } })).toBe(1);
    await assertAggregate(f.id);
  });
  test('gap/out-of-order revisions stay blocked; recovery must exceed highestSeen; revision conflict quarantines', async () => {
    const f = await fixture();

    expect(
      (await apply(f, event(f, '3', 'ProgramLimitUpdated', { currency: 'USD', limit: '300' })))
        .code,
    ).toBe('REVISION_GAP');
    expect(
      (await apply(f, event(f, '1', 'ProgramLimitUpdated', { currency: 'USD', limit: '150' })))
        .code,
    ).toBe('REVISION_GAP');
    expect(
      (await apply(f, event(f, '3', 'ProgramLimitUpdated', { currency: 'USD', limit: '999' })))
        .code,
    ).toBe('REVISION_CONFLICT');
    expect(
      (await db.program.findUniqueOrThrow({ where: { id: f.id } })).highestSeenTreasuryRevision,
    ).toBe(3n);
    expect((await apply(f, await snapshot(f, '2'))).code).toBe('RECOVERY_REVISION_TOO_LOW');
    expect((await apply(f, await snapshot(f, '4'))).code).toBe('APPLIED');
    expect(
      (await apply(f, event(f, '1', 'ProgramLimitUpdated', { currency: 'USD', limit: '150' })))
        .code,
    ).toBe('STALE');
    expect((await db.program.findUniqueOrThrow({ where: { id: f.id } })).syncStatus).toBe('READY');
    await assertAggregate(f.id);
  });
  test.each(['reserve', 'release'])(
    'snapshot prepared before %s cannot overwrite it, fresh recovery succeeds',
    async (action) => {
      const f = await fixture();
      const r = await f.service.reserve(f.principal, f.id, input('10'), key(), key());
      const stale = await snapshot(f);

      if (action === 'reserve')
        await f.service.reserve(f.principal, f.id, input('5'), key(), key());
      else await f.service.release(f.principal, f.id, r.body.id, key(), key());

      const before = await db.program.findUniqueOrThrow({ where: { id: f.id } });

      expect((await apply(f, stale)).code).toBe('STATE_VERSION_CONFLICT');
      expect((await db.program.findUniqueOrThrow({ where: { id: f.id } })).reservedMinor).toBe(
        before.reservedMinor,
      );
      expect((await f.service.reserve(f.principal, f.id, input('1'), key(), key())).body.code).toBe(
        'RECONCILIATION_REQUIRED',
      );
      expect((await apply(f, await snapshot(f))).code).toBe('APPLIED');
      expect((await f.service.capacity(f.principal, f.id)).syncStatus).toBe('READY');
      await assertAggregate(f.id);
    },
  );
  test('snapshot closes missing rows, restores missing rows atomically, preserves fixed FX and never revives a terminal invoice', async () => {
    const f = await fixture();
    const r = await f.service.reserve(f.principal, f.id, input('10', 'EUR'), key(), key());
    const original = await snapshot(f);

    if (original.type !== 'ProgramStateSnapshot') throw new Error();

    const corrupted = structuredClone(original);

    corrupted.payload.reservations[0].fx.rate = '2';
    const freshRow = { ...original.payload.reservations[0], id: key(), invoiceId: key() };

    corrupted.payload.reservations.unshift(freshRow);
    expect((await apply(f, corrupted)).code).toBe('INVALID_FX_AMOUNT');
    expect(await db.reservation.count({ where: { programId: f.id } })).toBe(1);
    const immutable = await snapshot(f);

    if (immutable.type !== 'ProgramStateSnapshot') throw new Error();

    immutable.payload.reservations[0].fx.source = 'different-source';
    expect((await apply(f, immutable)).code).toBe('RESERVATION_CONFLICT');
    const good = await snapshot(f);

    if (good.type !== 'ProgramStateSnapshot') throw new Error();

    good.payload.reservations.push(freshRow);
    expect((await apply(f, good)).code).toBe('APPLIED');
    const empty = await snapshot(f);

    if (empty.type !== 'ProgramStateSnapshot') throw new Error();

    empty.payload.reservations = [];
    expect((await apply(f, empty)).code).toBe('APPLIED');
    expect((await f.service.release(f.principal, f.id, r.body.id, key(), key())).body.status).toBe(
      'RECONCILED_CLOSED',
    );
    const revive = await snapshot(f);

    if (revive.type !== 'ProgramStateSnapshot') throw new Error();

    revive.payload.reservations = [original.payload.reservations[0]];
    expect((await apply(f, revive)).code).toBe('RESERVATION_CONFLICT');
    await assertAggregate(f.id);
  });
  test('full bounded snapshot fits the transaction; active-count and byte ceilings are enforced', async () => {
    const f = await fixture();
    const e = await snapshot(f);

    if (e.type !== 'ProgramStateSnapshot') throw new Error();

    const timestamp = new Date().toISOString();

    e.payload.reservations = Array.from({ length: 1000 }, () => ({
      id: key(),
      programId: f.id,
      invoiceId: key(),
      amount: '0.01',
      currency: 'USD',
      reservedAmount: '0.01',
      programCurrency: 'USD',
      fx: { rate: '1', direction: DIRECTION, source: 'IDENTITY', asOf: timestamp },
      status: 'ACTIVE',
      createdAt: timestamp,
      closedAt: null,
    }));
    expect((await apply(f, e)).code).toBe('APPLIED');
    expect((await f.service.capacity(f.principal, f.id)).acceptingReservations).toBe(false);
    expect((await f.service.reserve(f.principal, f.id, input('1'), key(), key())).body.code).toBe(
      'RESERVATION_LIMIT',
    );
    const oversized = await snapshot(f);
    const raw = Buffer.from(JSON.stringify(oversized) + ' '.repeat(MAX_EVENT_BYTES));

    expect(
      (
        await f.treasury.process(raw, `${f.principal.tenantId}:${f.id}`, {
          topic: 'oversize',
          partition: 0,
          offset: key(),
        })
      ).code,
    ).toBe('INVALID_EVENT');
    const p = await db.program.findUniqueOrThrow({ where: { id: f.id } });

    expect(p.highestSeenTreasuryRevision).toBe(2n);
    expect(p.reservedMinor).toBe(1000n);
    await assertAggregate(f.id);
  });
  test('reconciliation view remains consistent during concurrent writes', async () => {
    const f = await fixture();
    const writes = Promise.all(
      Array.from({ length: 12 }, () =>
        f.service.reserve(f.principal, f.id, input('1'), key(), key())),
    );

    for (let i = 0; i < 12; i++) {
      const v = await f.service.view(f.principal, f.id);

      expect(BigInt(v.stateVersion)).toBe(BigInt(v.reservations.length));
    }

    await writes;
    await assertAggregate(f.id);
  });
  test('DB rejects monetary, tenant and history violations', async () => {
    const f = await fixture();

    await expect(
      db.program.update({ where: { id: f.id }, data: { reservedMinor: -1n } }),
    ).rejects.toThrow();
    const r = await f.service.reserve(f.principal, f.id, input('1'), key(), key());

    await expect(
      db.reservation.update({ where: { id: r.body.id }, data: { tenantId: 'foreign' } }),
    ).rejects.toThrow();
    await expect(db.capacityMovement.deleteMany({ where: { programId: f.id } })).rejects.toThrow();
    await expect(db.reservation.delete({ where: { id: r.body.id } })).rejects.toThrow();
    await assertAggregate(f.id);
  });
});
describe('HTTP authentication, CASL, serialization and replay', () => {
  test('PostgreSQL sessions, JWT claims, DB roles, tenant resources, DTOs and envelopes', async () => {
    const f = await fixture();
    const settings = testSettings({
      DATABASE_URL: url,
      KAFKA_BROKERS: brokers.join(','),
      LOG_LEVEL: 'silent',
    });
    const app = await makeApplication(settings, db, f.health),
      server = app.getHttpServer(),
      path = '/api/v1/programs/' + f.id;

    async function jwt({
      tenantId = f.principal.tenantId,
      clientId = key(),
      roles = ['USER', 'TREASURY'],
      issuer = 'capacity-dev',
      audience = 'capacity-service',
      expiry = '5m',
      secret = settings.JWT_ACCESS_SECRET,
      type = 'access',
      store = true,
    } = {}) {
      const user = await db.user.create({
        data: {
          email: key() + '@http.test',
          passwordHash: 'fixture-only',
          tenantId,
          clientId,
          roles,
        },
      });
      const sid = key();

      if (store)
        await db.session.create({
          data: {
            id: sid,
            userId: user.id,
            refreshTokenHash: 'test',
            expiresAt: new Date(Date.now() + 60000),
          },
        });

      const token = await new SignJWT({ sid, type })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(String(user.id))
        .setIssuer(issuer)
        .setAudience(audience)
        .setJti(key())
        .setExpirationTime(expiry)
        .sign(Buffer.from(secret));

      return { token, user, sid };
    }
    try {
      for (const route of [
        path + '/capacity',
        path + '/reservations/' + key(),
        '/api/v1/internal/programs/' + f.id + '/reconciliation-view',
        '/api/v1/users/me',
        '/api/v1/health',
        '/docs',
        '/docs-json',
      ])
        expect((await request(server).get(route)).status).toBe(401);

      expect(
        (
          await request(server)
            .post(path + '/reservations')
            .send(input())
        ).status,
      ).toBe(401);
      expect(
        (
          await request(server)
            .post(path + '/reservations/' + key() + '/release')
            .send({})
        ).status,
      ).toBe(401);
      const invalid = [
        await jwt({ issuer: 'wrong' }),
        await jwt({ audience: 'wrong' }),
        await jwt({ expiry: '-1s' }),
        await jwt({ secret: 'wrong-secret'.repeat(4) }),
        await jwt({ type: 'refresh' }),
        await jwt({ store: false }),
      ];

      for (const bad of invalid)
        expect(
          (
            await request(server)
              .get(path + '/capacity')
              .auth(bad.token, { type: 'bearer' })
          ).status,
        ).toBe(401);

      expect(
        (
          await request(server)
            .get(path + '/capacity')
            .auth('garbage', { type: 'bearer' })
        ).status,
      ).toBe(401);
      const pair = await generateKeyPair('RS256');
      const rsa = await new SignJWT({ sid: key(), type: 'access' })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject('1')
        .setIssuer('capacity-dev')
        .setAudience('capacity-service')
        .setExpirationTime('5m')
        .sign(pair.privateKey);

      expect(
        (
          await request(server)
            .get(path + '/capacity')
            .auth(rsa, { type: 'bearer' })
        ).status,
      ).toBe(401);
      const foreign = await jwt({ tenantId: 'foreign' }),
        denied = await jwt({ roles: [] }),
        readonly = await jwt({ roles: ['READ_ONLY'] });

      expect(
        (
          await request(server)
            .get(path + '/capacity')
            .auth(foreign.token, { type: 'bearer' })
        ).status,
      ).toBe(404);
      expect(
        (
          await request(server)
            .get(path + '/capacity')
            .auth(denied.token, { type: 'bearer' })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(server)
            .get('/api/v1/internal/programs/' + f.id + '/reconciliation-view')
            .auth(readonly.token, { type: 'bearer' })
        ).status,
      ).toBe(403);
      const good = await jwt(),
        i = input('100'),
        k = key();
      // A pre-migration result keeps its tenant/client/key identity when the
      // client obtains a new database-backed session after migration.
      const legacy = await fixture(),
        legacyKey = key(),
        legacyInput = input('1', 'EUR');
      const legacyResult = await legacy.service.reserve(
        legacy.principal,
        legacy.id,
        legacyInput,
        legacyKey,
        key(),
      );

      await legacy.service.release(legacy.principal, legacy.id, legacyResult.body.id, key(), key());
      const legacyToken = await jwt({
        tenantId: legacy.principal.tenantId,
        clientId: legacy.principal.clientId,
      });
      const legacyVersion = (await db.program.findUniqueOrThrow({ where: { id: legacy.id } }))
        .stateVersion;
      const legacyReplay = await request(server)
        .post('/api/v1/programs/' + legacy.id + '/reservations')
        .auth(legacyToken.token, { type: 'bearer' })
        .set('Idempotency-Key', legacyKey)
        .send(legacyInput);

      expect(legacyReplay.status).toBe(201);
      expect(legacyReplay.body.data).toEqual(legacyResult.body);
      expect((await db.program.findUniqueOrThrow({ where: { id: legacy.id } })).stateVersion).toBe(
        legacyVersion,
      );
      expect(
        (await request(server).get('/docs-json').auth(good.token, { type: 'bearer' })).status,
      ).toBe(200);
      expect(
        (
          await request(server)
            .post(path + '/reservations')
            .auth(good.token, { type: 'bearer' })
            .set('Content-Type', 'application/json')
            .send('{bad')
        ).status,
      ).toBe(400);
      const missingKey = await request(server)
        .post(path + '/reservations')
        .auth(good.token, { type: 'bearer' })
        .send(i);

      expect(missingKey.status).toBe(422);
      expect(missingKey.body.error.code).toBe(422000);
      const invalidDto = await request(server)
        .post(path + '/reservations')
        .auth(good.token, { type: 'bearer' })
        .set('Idempotency-Key', key())
        .send({ ...i, tenantId: 'forged' });

      expect(invalidDto.status).toBe(422);
      expect(invalidDto.body.error.details.tenantId).toBeDefined();
      for (const badAmount of [
        input('1.001'),
        input('1.0', 'JPY'),
        input('92233720368547758.08'),
      ]) {
        const invalidAmount = await request(server)
          .post(path + '/reservations')
          .auth(good.token, { type: 'bearer' })
          .set('Idempotency-Key', key())
          .send(badAmount);

        expect(invalidAmount.status).toBe(422);
        expect(invalidAmount.body.error.details.amount).toBeDefined();
      }

      const first = await request(server)
        .post(path + '/reservations')
        .auth(good.token, { type: 'bearer' })
        .set('Idempotency-Key', k)
        .send(i);

      expect(first.status).toBe(201);
      expect(first.body.success).toBe(true);
      expect(first.body.data.tenantId).toBeUndefined();
      const replay = await request(server)
        .post(path + '/reservations')
        .auth(good.token, { type: 'bearer' })
        .set('Idempotency-Key', k)
        .send(i);

      expect(replay.body).toEqual(first.body);
      const duplicate = await request(server)
        .post(path + '/reservations')
        .auth(good.token, { type: 'bearer' })
        .set('Idempotency-Key', k)
        .send({ ...i, amount: '1' });

      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe(409102);
      const capacity = await request(server)
        .get(path + '/capacity')
        .auth(good.token, { type: 'bearer' });

      expect(capacity.body.data).toMatchObject({
        available: '0.00',
        acceptingReservations: false,
        stateVersion: '1',
      });
      const rid = first.body.data.id;

      expect(
        (
          await request(server)
            .get(path + '/reservations/' + rid)
            .auth(foreign.token, { type: 'bearer' })
        ).status,
      ).toBe(404);
      expect(
        (
          await request(server)
            .post(path + '/reservations/' + rid + '/release')
            .auth(good.token, { type: 'bearer' })
            .set('Idempotency-Key', key())
            .send({ amount: '1' })
        ).status,
      ).toBe(422);
      expect(
        (
          await request(server)
            .post(path + '/reservations/' + rid + '/release')
            .auth(good.token, { type: 'bearer' })
            .set('Idempotency-Key', key())
            .send({})
        ).status,
      ).toBe(200);
      await db.user.update({ where: { id: good.user.id }, data: { roles: [] } });
      expect(
        (
          await request(server)
            .get(path + '/capacity')
            .auth(good.token, { type: 'bearer' })
        ).status,
      ).toBe(403);
      await db.session.update({ where: { id: readonly.sid }, data: { revokedAt: new Date() } });
      expect(
        (
          await request(server)
            .get(path + '/capacity')
            .auth(readonly.token, { type: 'bearer' })
        ).status,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
});
describe('real Kafka delivery and offset ordering', () => {
  test('DB commit before offset failure replays after restart; malformed event advances only after quarantine', async () => {
    const f = await fixture();
    const topic = `treasury-${key()}`,
      group = `group-${key()}`;

    await admin.createTopics({ topics: [{ topic, numPartitions: 1, replicationFactor: 1 }] });
    const settings = testSettings({
      DATABASE_URL: url,
      KAFKA_BROKERS: brokers.join(','),
      KAFKA_TOPIC: topic,
      KAFKA_GROUP_ID: group,
      TREASURY_SOURCE: 'test-treasury',
      LOG_LEVEL: 'silent',
    });
    const logger = pino({ level: 'silent' });
    let current = new TreasuryConsumer(settings, f.treasury, f.health, logger);
    const original = current.consumer.commitOffsets.bind(current.consumer);
    const committed = jest
      .spyOn(current.consumer, 'commitOffsets')
      .mockImplementationOnce(async () => {
        throw new Error('Lost offset commit');
      })
      .mockImplementation(original);

    await current.start();
    await poll(
      async () => f.health.connected,
      (v) => v,
    );
    const e = await snapshot(f, '1');

    await producer.send({
      topic,
      messages: [{ key: `${e.tenantId}:${e.programId}`, value: JSON.stringify(e) }],
    });
    await poll(
      () => db.treasuryInbox.count({ where: { eventId: e.eventId } }),
      (v) => v === 1,
    );
    await poll(
      async () => committed.mock.calls.length,
      (v) => v >= 1,
    );
    await current.stop();
    const offsets = await admin.fetchOffsets({ groupId: group, topics: [topic] });

    expect(BigInt(offsets[0].partitions[0].offset)).toBeLessThanOrEqual(0n);
    current = new TreasuryConsumer(settings, f.treasury, f.health, logger);
    await current.start();
    try {
      await poll(
        () => admin.fetchOffsets({ groupId: group, topics: [topic] }),
        (v) => v[0].partitions[0].offset === '1',
      );
      expect(await db.capacityMovement.count({ where: { programId: f.id } })).toBe(1);
      expect((await db.program.findUniqueOrThrow({ where: { id: f.id } })).syncStatus).toBe(
        'RECONCILIATION_REQUIRED',
      );
      const recovery = await snapshot(f, '2');

      await producer.send({
        topic,
        messages: [
          { key: `${e.tenantId}:${e.programId}`, value: JSON.stringify(recovery) },
          { key: 'invalid', value: '{malformed' },
        ],
      });
      await poll(
        () => admin.fetchOffsets({ groupId: group, topics: [topic] }),
        (v) => v[0].partitions[0].offset === '3',
      );
      expect(await db.treasuryQuarantine.count({ where: { topic } })).toBe(1);
      expect((await db.program.findUniqueOrThrow({ where: { id: f.id } })).syncStatus).toBe(
        'READY',
      );
      await assertAggregate(f.id);
    } finally {
      await current.stop();
    }
  });
  test('a DB failure prevents committing the failed or later message in its partition', async () => {
    const f = await fixture();
    const topic = `treasury-${key()}`,
      group = `group-${key()}`;

    await admin.createTopics({ topics: [{ topic, numPartitions: 1, replicationFactor: 1 }] });
    const settings = testSettings({
      DATABASE_URL: url,
      KAFKA_BROKERS: brokers.join(','),
      KAFKA_TOPIC: topic,
      KAFKA_GROUP_ID: group,
      TREASURY_SOURCE: 'test-treasury',
      LOG_LEVEL: 'silent',
    });
    const consumer = new TreasuryConsumer(
      settings,
      f.treasury,
      f.health,
      pino({ level: 'silent' }),
    );
    const failure = jest.spyOn(f.treasury, 'process');

    await consumer.start();
    await poll(
      async () => f.health.connected,
      (v) => v,
    );
    await db.$executeRaw`ALTER TABLE "TreasuryInbox" RENAME TO "TemporarilyUnavailableInbox"`;
    const e = await snapshot(f, '1');

    await producer.send({
      topic,
      messages: [
        { key: `${e.tenantId}:${e.programId}`, value: JSON.stringify(e) },
        {
          key: `${e.tenantId}:${e.programId}`,
          value: JSON.stringify({ ...e, eventId: key(), treasuryRevision: '2' }),
        },
      ],
    });
    try {
      await poll(
        async () => failure.mock.calls.length,
        (v) => v >= 1,
      );
      const offsets = await admin.fetchOffsets({ groupId: group, topics: [topic] });

      expect(BigInt(offsets[0].partitions[0].offset)).toBeLessThanOrEqual(0n);
    } finally {
      await consumer.stop();
      failure.mockRestore();
      await db.$executeRaw`ALTER TABLE "TemporarilyUnavailableInbox" RENAME TO "TreasuryInbox"`;
    }

    expect(await db.treasuryInbox.count({ where: { topic } })).toBe(0);
  });
  test('isolated broker outage blocks admission, permits release, and requires a fresh snapshot after reconnect', async () => {
    const f = await fixture();
    const topic = `treasury-${key()}`,
      group = `group-${key()}`;

    await admin.createTopics({ topics: [{ topic, numPartitions: 1, replicationFactor: 1 }] });
    const settings = testSettings({
      DATABASE_URL: url,
      KAFKA_BROKERS: brokers.join(','),
      KAFKA_TOPIC: topic,
      KAFKA_GROUP_ID: group,
      TREASURY_SOURCE: 'test-treasury',
      LOG_LEVEL: 'silent',
    });
    const consumer = new TreasuryConsumer(
      settings,
      f.treasury,
      f.health,
      pino({ level: 'silent' }),
    );
    const send = async (e) =>
      producer.send({
        topic,
        messages: [{ key: `${e.tenantId}:${e.programId}`, value: JSON.stringify(e) }],
      });

    await consumer.start();
    await poll(
      async () => f.health.connected,
      (v) => v,
    );
    await send(await snapshot(f, '1'));
    await poll(
      () => db.program.findUniqueOrThrow({ where: { id: f.id } }),
      (p) => p.syncStatus === 'READY',
    );
    const reservation = await f.service.reserve(f.principal, f.id, input('1'), key(), key());
    // Pause only this suite's disposable broker, preserving its random host port.
    // Keep it unavailable until detection rather than sleeping for a guessed time.
    const runtime = await getContainerRuntimeClient();
    const container = runtime.container.getById(broker.getId());

    await container.pause();
    try {
      await poll(
        () => db.program.findUniqueOrThrow({ where: { id: f.id } }),
        (p) => p.syncStatus === 'RECONCILIATION_REQUIRED',
        30000,
      );
      expect((await f.service.capacity(f.principal, f.id)).acceptingReservations).toBe(false);
      expect((await f.service.reserve(f.principal, f.id, input('1'), key(), key())).body.code).toBe(
        'RECONCILIATION_REQUIRED',
      );
      expect(
        (await f.service.release(f.principal, f.id, reservation.body.id, key(), key())).status,
      ).toBe(200);
    } finally {
      await container.unpause();
    }

    try {
      await poll(
        async () => f.health.connected,
        (v) => v,
        40000,
      );
      expect((await db.program.findUniqueOrThrow({ where: { id: f.id } })).syncStatus).toBe(
        'RECONCILIATION_REQUIRED',
      );
      await send(await snapshot(f, '2'));
      await poll(
        () => db.program.findUniqueOrThrow({ where: { id: f.id } }),
        (p) => p.syncStatus === 'READY',
        40000,
      );
      await assertAggregate(f.id);
    } finally {
      await consumer.stop();
    }
  });
});
