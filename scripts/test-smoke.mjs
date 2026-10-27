import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Network, Wait, getContainerRuntimeClient } from 'testcontainers';
import { hash } from 'bcryptjs';
import { database } from '../dist/core/providers/prisma/create-database.js';
import {
  POSTGRES_IMAGE,
  KAFKA_IMAGE,
  prisma,
  testDatabaseUrl,
  kafkaEnvironment,
  stopOwned,
  waitFor,
} from './test-support.mjs';

const owned = [],
  logs = [];
let network, db;
const capture = (name) => (stream) =>
  stream.on('data', (chunk) => {
    logs.push(name + ': ' + chunk.toString());
    if (logs.length > 1000) logs.shift();
  });
try {
  network = await new Network().start();
  const postgres = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase('app_test_smoke')
    .withNetwork(network)
    .withNetworkAliases('postgres')
    .start();
  owned.push(postgres);
  const url = testDatabaseUrl(postgres.getConnectionUri());
  prisma(['migrate', 'deploy'], { ...process.env, DATABASE_URL: url });
  db = database(url);
  const programId = randomUUID(),
    tenantId = 'smoke-' + randomUUID(),
    password = randomBytes(24).toString('base64url');
  const email = 'smoke@example.test';
  await db.program.create({
    data: { id: programId, tenantId, currency: 'USD', limitMinor: 10000000n },
  });
  await db.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      tenantId,
      clientId: 'smoke-client',
      roles: ['USER', 'TREASURY'],
    },
  });
  const kafka = await new GenericContainer(KAFKA_IMAGE)
    .withNetwork(network)
    .withNetworkAliases('kafka')
    .withEnvironment(kafkaEnvironment())
    .withWaitStrategy(Wait.forLogMessage(/Kafka Server started/))
    .withStartupTimeout(120000)
    .withLogConsumer(capture('kafka'))
    .start();
  owned.push(kafka);
  const topic = 'treasury-' + randomUUID();
  assert.equal(
    (
      await kafka.exec([
        '/opt/kafka/bin/kafka-topics.sh',
        '--bootstrap-server',
        'kafka:9092',
        '--create',
        '--topic',
        topic,
        '--partitions',
        '3',
        '--replication-factor',
        '1',
      ])
    ).exitCode,
    0,
  );
  const env = {
    DATABASE_URL:
      'postgresql://' +
      postgres.getUsername() +
      ':' +
      postgres.getPassword() +
      '@postgres:5432/app_test_smoke',
    JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
    JWT_REFRESH_SECRET: randomBytes(48).toString('base64url'),
    KAFKA_BROKERS: 'kafka:9092',
    KAFKA_TOPIC: topic,
    KAFKA_GROUP_ID: 'smoke-' + randomUUID(),
    TREASURY_SOURCE: 'smoke',
    LOG_LEVEL: 'info',
    NODE_ENV: 'production',
  };
  const app = await new GenericContainer(process.env.APP_IMAGE ?? 'program-capacity-service:local')
    .withNetwork(network)
    .withNetworkAliases('app')
    .withEnvironment(env)
    .withExposedPorts(3000)
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(120000)
    .withLogConsumer(capture('app'))
    .start();
  owned.push(app);
  assert.equal((await app.exec(['id', '-u'])).output.trim(), '1000');
  assert.equal(
    (
      await app.exec([
        'node',
        '-e',
        "const fs=require('fs');for(const p of ['src','scripts','node_modules/prisma','node_modules/typescript'," +
        "'node_modules/jest','/usr/local/lib/node_modules/npm','/usr/bin/mount','/usr/bin/umount','/usr/bin/nsenter'," +
        "'/usr/sbin/blkid','/usr/sbin/findfs','/usr/bin/lsblk','/usr/bin/infocmp','/usr/bin/gzip','/usr/lib/systemd/systemd-homed'," +
        "'/usr/share/perl/5.36/Archive/Tar.pm','/usr/lib/x86_64-linux-gnu/perl-base/Archive/Tar.pm'])" +
        "if(fs.existsSync(p))throw new Error('Unexpected runtime tool: '+p);fs.accessSync('dist/generated/prisma/client.js')",
      ])
    ).exitCode,
    0,
  );
  const links = await app.exec(['ldd', '/usr/local/bin/node']);
  assert.equal(links.exitCode, 0);
  assert.doesNotMatch(links.output, /libacl|libblkid|libmount|libtinfo/);
  const privileged = await app.exec([
    'find',
    '/usr',
    '-xdev',
    '-type',
    'f',
    '-perm',
    '/6000',
    '-print',
  ]);
  assert.equal(privileged.exitCode, 0);
  assert.equal(privileged.output.trim(), '');
  const clientEnv = {
    ...env,
    NODE_ENV: 'test',
    API_URL: 'http://app:3000',
    SMOKE_EMAIL: email,
    SMOKE_PASSWORD: password,
    DEMO_PROGRAM_ID: programId,
    DEMO_TENANT_ID: tenantId,
  };
  async function scenario(command = ['node', 'scripts/smoke-client.mjs']) {
    const client = await new GenericContainer(
      process.env.TOOLS_IMAGE ?? 'program-capacity-tools:local',
    )
      .withNetwork(network)
      .withEnvironment(clientEnv)
      .withCommand(command)
      .withWaitStrategy(Wait.forOneShotStartup())
      .withStartupTimeout(120000)
      .withLogConsumer(capture('client'))
      .start();
    owned.push(client);
  }
  await scenario();
  assert.equal(await db.reservation.count({ where: { programId } }), 2);
  assert.equal(await db.capacityMovement.count({ where: { programId, reason: 'RESERVE' } }), 2);
  assert.equal(await db.capacityMovement.count({ where: { programId, reason: 'RELEASE' } }), 2);
  assert.equal(
    (await db.program.findUniqueOrThrow({ where: { id: programId } })).reservedMinor,
    0n,
  );
  const runtime = await getContainerRuntimeClient(),
    container = runtime.container.getById(app.getId());
  await container.stop({ t: 40 });
  assert.equal(
    (await container.inspect()).State.ExitCode,
    0,
    'SIGTERM must exit cleanly before Docker SIGKILL',
  );
  await container.start();
  const restarted = await container.inspect();
  const origin =
    'http://' + app.getHost() + ':' + restarted.NetworkSettings.Ports['3000/tcp'][0].HostPort;
  await waitFor(
    async () => {
      try {
        return await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(2000) });
      } catch {
        return null;
      }
    },
    (response) => response?.status === 401,
    'application restart',
  );
  assert.equal(
    (await db.program.findUniqueOrThrow({ where: { id: programId } })).syncStatus,
    'RECONCILIATION_REQUIRED',
  );
  await scenario();
  assert.equal(await db.reservation.count({ where: { programId } }), 4);
  // Execute the documented CLI wrapper too, on this harness's owned program/tenant.
  await scenario(['npm', 'run', 'demo']);
  assert.equal(await db.reservation.count({ where: { programId } }), 6);
  const p = await db.program.findUniqueOrThrow({ where: { id: programId } });
  const ledger = await db.capacityMovement.aggregate({
    where: { programId },
    _sum: { reservedDelta: true },
  });
  assert.equal(p.reservedMinor, 0n);
  assert.equal(ledger._sum.reservedDelta, 0n);
  console.log(
    'Production image smoke, CLI demo, migrations, real Kafka, idempotency, FX, ledger and SIGTERM/restart passed.',
  );
} catch (error) {
  console.error(logs.join('').slice(-64000));
  throw error;
} finally {
  try {
    await db?.$disconnect();
  } finally {
    await stopOwned(owned, network);
  }
}
