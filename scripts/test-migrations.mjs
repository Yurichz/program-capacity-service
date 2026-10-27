import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { database } from '../dist/core/providers/prisma/create-database.js';
import { POSTGRES_IMAGE, prisma, testDatabaseUrl } from './test-support.mjs';

const cluster = await new PostgreSqlContainer(POSTGRES_IMAGE)
  .withDatabase('app_test_migrations')
  .start();
let db, scratch;
try {
  const env = { ...process.env, DATABASE_URL: testDatabaseUrl(cluster.getConnectionUri()) };
  scratch = await mkdtemp(join(tmpdir(), 'capacity-migrations-'));
  const migrationPath = join(scratch, 'migrations');
  await mkdir(migrationPath);
  const names = (await readdir('prisma/migrations')).filter((name) => /^\d/.test(name)).sort();
  assert.ok(names.includes('202610270001_session_fk_consistency'));
  for (const name of names.filter((name) => name < '202610270001_session_fk_consistency'))
    await cp(join('prisma/migrations', name), join(migrationPath, name), { recursive: true });
  await cp('prisma/migrations/migration_lock.toml', join(migrationPath, 'migration_lock.toml'));
  const config = join(scratch, 'prisma.config.mjs');
  await writeFile(
    config,
    'export default ' +
      JSON.stringify({
        schema: resolve('prisma/schema.prisma'),
        migrations: { path: migrationPath },
        datasource: { url: env.DATABASE_URL },
      }),
  );
  prisma(['migrate', 'deploy', '--config', config], env);
  db = database(env.DATABASE_URL);
  const programId = randomUUID(),
    reservationId = randomUUID(),
    tenantId = 'migration-fixture';
  await db.program.create({
    data: {
      id: programId,
      tenantId,
      currency: 'USD',
      limitMinor: 100000n,
      reservedMinor: 110n,
      stateVersion: 1n,
    },
  });
  await db.reservation.create({
    data: {
      id: reservationId,
      tenantId,
      programId,
      invoiceId: 'upgrade-invoice',
      invoiceMinor: 100n,
      invoiceCurrency: 'EUR',
      reservedMinor: 110n,
      fxRate: '1.1',
      fxDirection: 'PROGRAM_MAJOR_PER_INVOICE_MAJOR',
      fxSource: 'upgrade-fixture',
      fxAsOf: new Date(),
    },
  });
  await db.capacityMovement.create({
    data: {
      id: randomUUID(),
      tenantId,
      programId,
      reservationId,
      reservedDelta: 110n,
      limitDelta: 0n,
      stateVersion: 1n,
      reason: 'RESERVE',
      actor: 'upgrade-client',
      operationId: randomUUID(),
    },
  });
  await db.idempotencyRequest.create({
    data: {
      tenantId,
      clientId: 'upgrade-client',
      key: 'upgrade-key',
      programId,
      fingerprint: 'fixture',
      status: 201,
      result: { id: reservationId, reservedAmount: '1.10' },
    },
  });
  const user = await db.user.create({
    data: {
      email: 'migration@example.test',
      passwordHash: 'fixture',
      tenantId,
      clientId: 'upgrade-client',
    },
  });
  await db.session.create({
    data: {
      id: randomUUID(),
      userId: user.id,
      refreshTokenHash: 'fixture',
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  await db.treasuryInbox.create({
    data: {
      id: randomUUID(),
      source: 'fixture',
      eventId: randomUUID(),
      tenantId,
      programId,
      revision: 1n,
      fingerprint: 'fixture',
      revisionFingerprint: 'fixture',
      topic: 'fixture',
      partition: 0,
      offset: '0',
      payload: {},
      result: { code: 'APPLIED' },
    },
  });
  await db.treasuryQuarantine.create({
    data: {
      id: randomUUID(),
      source: 'fixture',
      topic: 'fixture',
      partition: 0,
      offset: '1',
      rawBase64: 'e30=',
      reason: 'INVALID_EVENT',
    },
  });
  const tables = [
    'program',
    'reservation',
    'capacityMovement',
    'idempotencyRequest',
    'user',
    'session',
    'treasuryInbox',
    'treasuryQuarantine',
  ];
  const before = await Promise.all(tables.map((table) => db[table].findMany()));
  // Apply every remaining migration to representative data; never rewrite old migration files.
  for (const name of names)
    await cp(join('prisma/migrations', name), join(migrationPath, name), { recursive: true });
  prisma(['migrate', 'deploy', '--config', config], env);
  assert.deepEqual(await Promise.all(tables.map((table) => db[table].findMany())), before);
  prisma(['migrate', 'deploy'], env);
  prisma(['validate'], env);
  prisma(['migrate', 'status'], env);
  prisma(
    [
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
    ],
    env,
  );
  const constraints =
    await db.$queryRaw`SELECT conname FROM pg_constraint WHERE conname IN (
      'program_amounts','program_currency','reservation_money','reservation_terminal_time','inbox_revision','idempotency_result'
    )`;
  assert.equal(constraints.length, 6, 'Raw SQL checks must survive migrations');
  const triggers =
    await db.$queryRaw`SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal AND tgname IN ('movement_append_only','reservation_history') AND tgenabled <> 'D'`;
  assert.equal(triggers.length, 2);
  const fk =
    await db.$queryRaw`SELECT confupdtype::text AS confupdtype, confdeltype::text AS confdeltype
      FROM pg_constraint WHERE conname = 'Session_userId_fkey'`;
  assert.equal(fk[0].confupdtype, 'c');
  assert.equal(fk[0].confdeltype, 'c');
  await assert.rejects(
    db.program.update({ where: { id: programId }, data: { reservedMinor: -1n } }),
  );
  await assert.rejects(
    db.reservation.update({ where: { id: reservationId }, data: { reservedMinor: 1n } }),
  );
  await assert.rejects(db.capacityMovement.deleteMany({ where: { programId } }));
  // Also prove all committed migrations deploy directly onto a completely empty schema.
  await db.$executeRaw`CREATE SCHEMA clean_migration`;
  const clean = new URL(env.DATABASE_URL);
  clean.searchParams.set('schema', 'clean_migration');
  prisma(['migrate', 'deploy'], { ...env, DATABASE_URL: clean.href });
  prisma(
    [
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
    ],
    { ...env, DATABASE_URL: clean.href },
  );
  console.log(
    'Migration deployment, upgrade preservation, repeat deployment, drift and SQL guards passed.',
  );
} finally {
  try {
    await db?.$disconnect();
  } finally {
    await cluster.stop();
  }
  if (scratch) {
    assert.ok(resolve(scratch).startsWith(resolve(tmpdir()) + sep));
    await rm(scratch, { recursive: true, force: true });
  }
}
