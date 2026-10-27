import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';
import { Kafka, logLevel } from 'kafkajs';
import { database } from '../../dist/core/providers/prisma/create-database.js';
import { POSTGRES_IMAGE, KAFKA_IMAGE, prisma, testDatabaseUrl } from '../../scripts/test-support.mjs';

async function until(read, accept, description, timeout = 60000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const value = await read();

    if (accept(value)) return value;

    await setTimeout(50);
  }

  throw new Error('Timed out waiting for ' + description);
}

function worker(env, crash = false) {
  const child = fork(new URL('./kafka-child.mjs', import.meta.url), [], {
    env: { ...process.env, ...env, AUDIT_CRASH_BEFORE_OFFSET: String(crash) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const messages = [];
  let output = '';

  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      output = (output + chunk).slice(-12000);
    });

  child.on('message', (message) => messages.push(message));
  const closed = once(child, 'exit');

  return {
    child,
    closed,
    messages,
    async message(type) {
      return until(
        () => {
          if (child.exitCode !== null || child.signalCode !== null)
            throw new Error('Worker exited before ' + type + ': ' + output);

          return messages.find((message) => message.type === type);
        },
        Boolean,
        type + ': ' + output,
      );
    },
    async kill() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');

      await closed;
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;

      child.send({ type: 'stop' });
      const result = await Promise.race([closed, setTimeout(40000, null, { ref: false })]);

      if (!result) {
        await this.kill();
        throw new Error('Worker graceful shutdown exceeded 40 seconds: ' + output);
      }

      assert.equal(result[0], 0, 'Worker must stop cleanly: ' + output);
    },
  };
}

test('KAFKA-CRASH-01: process death after durable DB commit replays once and recovers from a fresh snapshot', {
  timeout: 240000,
}, async (t) => {
  const owned = [];
  const workers = [];
  let db, producer, admin;

  try {
    const postgres = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase('app_test_crash_' + randomUUID().replaceAll('-', ''))
      .start();

    owned.push(postgres);
    const url = testDatabaseUrl(postgres.getConnectionUri());

    prisma(['migrate', 'deploy'], { ...process.env, DATABASE_URL: url });
    db = database(url);
    const broker = await new GenericContainer(KAFKA_IMAGE)
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
        CLUSTER_ID: randomUUID().replaceAll('-', '').slice(0, 22),
      })
      .withEntrypoint(['sh', '-c'])
      .withCommand([
        'echo WAITING_FOR_AUDIT_SCRIPT; while [ ! -f /tmp/audit-start.sh ]; do sleep 0.1; done; exec sh /tmp/audit-start.sh',
      ])
      .withWaitStrategy(Wait.forLogMessage('WAITING_FOR_AUDIT_SCRIPT'))
      .withStartupTimeout(60000)
      .start();

    owned.push(broker);
    const brokers = [`${broker.getHost()}:${broker.getMappedPort(9092)}`];

    await broker.copyContentToContainer([{
      target: '/tmp/audit-start.sh',
      content: `export KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://${brokers[0]}\nexec /etc/kafka/docker/run\n`,
    }]);
    const kafka = new Kafka({
      clientId: 'verification-' + randomUUID(),
      brokers,
      logLevel: logLevel.NOTHING,
      retry: { retries: 20, initialRetryTime: 100 },
    });

    admin = kafka.admin();
    await admin.connect();
    const topic = 'verification-' + randomUUID();
    const group = 'verification-' + randomUUID();

    await admin.createTopics({ topics: [{ topic, numPartitions: 1, replicationFactor: 1 }] });
    producer = kafka.producer({ allowAutoTopicCreation: false });
    await producer.connect();
    const programId = randomUUID();
    const tenantId = 'verification-' + randomUUID();

    await db.program.create({ data: { id: programId, tenantId, currency: 'USD', limitMinor: 10000n } });
    const childEnv = {
      AUDIT_DATABASE_URL: url,
      AUDIT_KAFKA_BROKERS: brokers.join(','),
      AUDIT_KAFKA_TOPIC: topic,
      AUDIT_KAFKA_GROUP: group,
      AUDIT_TREASURY_SOURCE: 'verification-' + randomUUID(),
    };
    const first = worker(childEnv, true);

    workers.push(first);
    await first.message('group-join');
    const row = {
      id: randomUUID(),
      programId,
      invoiceId: 'crash-invoice-' + randomUUID(),
      amount: '10.00',
      currency: 'USD',
      reservedAmount: '10.00',
      programCurrency: 'USD',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      closedAt: null,
      fx: {
        rate: '1',
        direction: 'PROGRAM_MAJOR_PER_INVOICE_MAJOR',
        source: 'verification',
        asOf: new Date().toISOString(),
      },
    };
    const initial = {
      schemaVersion: 1,
      eventId: randomUUID(),
      tenantId,
      programId,
      type: 'ProgramStateSnapshot',
      treasuryRevision: '1',
      occurredAt: new Date().toISOString(),
      payload: { currency: 'USD', limit: '150.00', baseStateVersion: '0', reservations: [row] },
    };
    const publish = (event) => producer.send({
      topic,
      messages: [{ key: `${tenantId}:${programId}`, value: JSON.stringify(event) }],
    });

    await publish(initial);
    const held = await first.message('before-offset');

    assert.equal(held.offsets[0].offset, '1');
    const before = await db.program.findUniqueOrThrow({ where: { id: programId } });

    assert.equal(before.stateVersion, 1n);
    assert.equal(before.lastAppliedTreasuryRevision, 1n);
    assert.equal(before.reservedMinor, 1000n);
    assert.equal(before.limitMinor, 15000n);
    assert.equal((await db.treasuryInbox.findFirstOrThrow({ where: { eventId: initial.eventId } })).result.code, 'APPLIED');
    assert.equal(await db.capacityMovement.count({ where: { programId } }), 1);
    const offsets = () => admin.fetchOffsets({ groupId: group, topics: [topic] });

    assert.ok(BigInt((await offsets())[0].partitions[0].offset) <= 0n);
    await first.kill();
    assert.ok(first.child.exitCode !== 0 || first.child.signalCode, 'The first process was forcibly terminated');
    console.log('DB commit was durable; broker offset remained uncommitted; first process was killed.');

    const second = worker(childEnv);

    workers.push(second);
    const restartedJoin = await second.message('group-join');

    assert.notEqual(restartedJoin.pid, held.pid);
    await until(offsets, (value) => value[0].partitions[0].offset === '1', 'replayed broker offset');
    const replayed = await db.program.findUniqueOrThrow({ where: { id: programId } });

    assert.equal(replayed.stateVersion, before.stateVersion);
    assert.equal(replayed.limitMinor, before.limitMinor);
    assert.equal(replayed.reservedMinor, before.reservedMinor);
    assert.equal(replayed.lastAppliedTreasuryRevision, before.lastAppliedTreasuryRevision);
    assert.equal(replayed.syncStatus, 'RECONCILIATION_REQUIRED');
    assert.equal(await db.treasuryInbox.count({ where: { eventId: initial.eventId } }), 1);
    assert.equal(await db.capacityMovement.count({ where: { programId } }), 1);
    assert.equal(await db.reservation.count({ where: { programId } }), 1);
    await publish({
      ...initial,
      eventId: randomUUID(),
      treasuryRevision: '2',
      occurredAt: new Date().toISOString(),
      payload: { currency: 'USD', limit: '125.00', baseStateVersion: '1', reservations: [row] },
    });
    await until(offsets, (value) => value[0].partitions[0].offset === '2', 'fresh snapshot broker offset');
    const recovered = await db.program.findUniqueOrThrow({ where: { id: programId } });

    assert.equal(recovered.syncStatus, 'READY');
    assert.equal(recovered.limitMinor, 12500n);
    assert.equal(recovered.stateVersion, 2n);
    assert.equal(recovered.reservedMinor, 1000n);
    assert.equal(await db.capacityMovement.count({ where: { programId } }), 2);
    const active = await db.reservation.aggregate({ where: { programId, status: 'ACTIVE' }, _sum: { reservedMinor: true } });
    const ledger = await db.capacityMovement.aggregate({ where: { programId }, _sum: { reservedDelta: true } });

    assert.equal(active._sum.reservedMinor ?? 0n, recovered.reservedMinor);
    assert.equal(ledger._sum.reservedDelta ?? 0n, recovered.reservedMinor);
    await t.test('AUD-KAFKA-RISK-01: characterize malformed JSON with a valid resource key', async () => {
      await producer.send({ topic, messages: [{ key: `${tenantId}:${programId}`, value: '{malformed' }] });
      await until(offsets, (value) => value[0].partitions[0].offset === '3', 'quarantined malformed offset');
      const quarantined = await db.treasuryQuarantine.findFirstOrThrow({ where: { topic, offset: '2' } });

      assert.equal(quarantined.reason, 'INVALID_EVENT');
      const unchanged = await db.program.findUniqueOrThrow({ where: { id: programId } });

      assert.equal(unchanged.syncStatus, 'READY', 'Characterization: a key alone does not invalidate the program');
      assert.equal(unchanged.stateVersion, recovered.stateVersion);
      assert.equal(unchanged.highestSeenTreasuryRevision, recovered.highestSeenTreasuryRevision);
      console.log('Risk characterization: malformed JSON is durably quarantined and acknowledged while the keyed program remains READY.');
    });
    console.log('Fresh process replayed exactly once; persisted versions/ledger were preserved; revision 2 restored READY.');
    let third;

    await t.test('AUD-KAFKA-QUARANTINE-01: quarantine persistence failure cannot acknowledge a bad or later message', async () => {
      const later = {
        ...initial,
        eventId: randomUUID(),
        treasuryRevision: '3',
        occurredAt: new Date().toISOString(),
        payload: { currency: 'USD', limit: '125.00', baseStateVersion: '2', reservations: [row] },
      };

      // Fault injection is confined to this harness's disposable PostgreSQL instance.
      await db.$executeRaw`ALTER TABLE "TreasuryQuarantine" RENAME TO "AuditUnavailableQuarantine"`;
      try {
        await producer.send({
          topic,
          messages: [
            { key: `${tenantId}:${programId}`, value: '{quarantine-unavailable' },
            { key: `${tenantId}:${programId}`, value: JSON.stringify(later) },
          ],
        });
        const failed = await second.message('process-failed');

        assert.equal(failed.coordinates.topic, topic);
        assert.equal(failed.coordinates.offset, '3');
        await second.message('consumer-crash');
        assert.equal((await offsets())[0].partitions[0].offset, '3');
        assert.equal(await db.treasuryInbox.count({ where: { eventId: later.eventId } }), 0);
        assert.equal((await db.program.findUniqueOrThrow({ where: { id: programId } })).stateVersion, 2n);
        await second.stop();
      } finally {
        await db.$executeRaw`ALTER TABLE "AuditUnavailableQuarantine" RENAME TO "TreasuryQuarantine"`;
      }

      third = worker(childEnv);
      workers.push(third);
      await third.message('group-join');
      await until(offsets, (value) => value[0].partitions[0].offset === '5', 'quarantine failure replay');
      assert.equal((await db.treasuryQuarantine.findFirstOrThrow({ where: { topic, offset: '3' } })).reason, 'INVALID_EVENT');
      assert.equal((await db.treasuryInbox.findFirstOrThrow({ where: { eventId: later.eventId } })).result.code, 'APPLIED');
      const afterReplay = await db.program.findUniqueOrThrow({ where: { id: programId } });

      assert.equal(afterReplay.syncStatus, 'READY');
      assert.equal(afterReplay.stateVersion, 3n);
      assert.equal(afterReplay.reservedMinor, 1000n);
      assert.equal(await db.capacityMovement.count({ where: { programId } }), 3);
      console.log('Failed quarantine left broker offset at 3 and blocked the later event; restored persistence replayed both safely.');
    });
    await t.test('AUD-KAFKA-REBALANCE-01: two live consumers reassign the partition after its owner leaves', async () => {
      const joins = (current) => current.messages.filter((message) => message.type === 'group-join');
      const previousJoins = joins(third).length;
      const fourth = worker(childEnv);

      workers.push(fourth);
      await fourth.message('group-join');
      await until(() => joins(third), (value) => value.length > previousJoins, 'existing consumer rejoin');
      await until(
        () => admin.describeGroups([group]),
        (value) => value.groups[0].state === 'Stable' && value.groups[0].members.length === 2,
        'two live broker group members',
      );
      const assignments = [third, fourth].map((current) => ({
        worker: current,
        partitions: joins(current).at(-1).assignment[topic] ?? [],
      }));

      assert.equal(assignments.reduce((sum, current) => sum + current.partitions.length, 0), 1);
      const owner = assignments.find((current) => current.partitions.includes(0)).worker;
      const survivor = assignments.find((current) => current.worker !== owner).worker;
      const survivorJoins = joins(survivor).length;

      await owner.stop();
      await until(
        () => joins(survivor),
        (value) => value.length > survivorJoins && value.at(-1).assignment[topic]?.includes(0),
        'partition reassignment to surviving consumer',
      );
      await publish({
        ...initial,
        eventId: randomUUID(),
        treasuryRevision: '4',
        occurredAt: new Date().toISOString(),
        payload: { currency: 'USD', limit: '125.00', baseStateVersion: '3', reservations: [row] },
      });
      await until(offsets, (value) => value[0].partitions[0].offset === '6', 'surviving consumer event');
      const afterRebalance = await db.program.findUniqueOrThrow({ where: { id: programId } });

      assert.equal(afterRebalance.syncStatus, 'READY');
      assert.equal(afterRebalance.stateVersion, 4n);
      assert.equal(afterRebalance.reservedMinor, 1000n);
      assert.equal(await db.capacityMovement.count({ where: { programId } }), 4);
      assert.equal(await db.reservation.count({ where: { programId } }), 1);
      await survivor.stop();
      console.log('Broker reported two live members; partition moved to the survivor and a fresh snapshot recovered READY.');
    });
  } finally {
    const results = await Promise.allSettled(workers.map((current) => current.kill()));

    for (const resource of [producer, admin])
      if (resource) results.push(...await Promise.allSettled([resource.disconnect()]));

    if (db) results.push(...await Promise.allSettled([db.$disconnect()]));

    for (const container of owned.reverse()) results.push(...await Promise.allSettled([container.stop()]));

    assert.deepEqual(results.filter((result) => result.status === 'rejected'), [], 'Owned resource cleanup must succeed');
  }
});
