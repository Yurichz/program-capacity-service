import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { pino } from 'pino';
import { database, prismaFor } from '../../dist/core/providers/prisma/create-database.js';
import { FinancialTransactionService } from '../../dist/core/providers/prisma/financial-transaction.service.js';
import { ConsumerHealth } from '../../dist/core/providers/kafka/consumer-health.provider.js';
import { TreasuryConsumer } from '../../dist/core/providers/kafka/treasury-consumer.provider.js';
import { FxRateProvider } from '../../dist/core/providers/fx/fx-rate.provider.js';
import { CapacityRepository } from '../../dist/core/routes/capacity/layers/capacity-da/capacity.repository.js';
import { CapacityClService } from '../../dist/core/routes/capacity/layers/capacity-cl/capacity-cl.service.js';
import { TreasuryRepository } from '../../dist/core/routes/treasury/layers/treasury-da/treasury.repository.js';
import { TreasuryClService } from '../../dist/core/routes/treasury/layers/treasury-cl/treasury-cl.service.js';
import { TreasuryService } from '../../dist/core/routes/treasury/layers/treasury-bl/treasury.service.js';
import { validateEnvironment } from '../../dist/config/environment.config.js';

assert.ok(process.send, 'Launch this owned test worker with child_process.fork');
assert.match(new URL(process.env.AUDIT_DATABASE_URL).pathname, /^\/app_test_[a-z0-9_]+$/);
const db = database(process.env.AUDIT_DATABASE_URL);
const prisma = prismaFor(db);
const config = validateEnvironment({
  DATABASE_URL: process.env.AUDIT_DATABASE_URL,
  KAFKA_BROKERS: process.env.AUDIT_KAFKA_BROKERS,
  KAFKA_TOPIC: process.env.AUDIT_KAFKA_TOPIC,
  KAFKA_GROUP_ID: process.env.AUDIT_KAFKA_GROUP,
  TREASURY_SOURCE: process.env.AUDIT_TREASURY_SOURCE,
  JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
  JWT_REFRESH_SECRET: randomBytes(48).toString('base64url'),
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
});
const settings = new ConfigService(config);
const health = new ConsumerHealth();
const capacity = new CapacityRepository(prisma);
const inbox = new TreasuryRepository(prisma, settings);
const transactions = new FinancialTransactionService(prisma);
const treasury = new TreasuryService(
  new TreasuryClService(capacity, inbox, transactions, settings),
  new CapacityClService(capacity, health, new FxRateProvider(), transactions, prisma),
  inbox,
);
const subject = new TreasuryConsumer(config, treasury, health, pino({ level: 'silent' }));
const send = (message) => process.send({ ...message, pid: process.pid });
const processTreasury = treasury.process.bind(treasury);

treasury.process = async (...args) => {
  try {
    return await processTreasury(...args);
  } catch (error) {
    send({ type: 'process-failed', coordinates: args[2] });
    throw error;
  }
};
subject.consumer.on(subject.consumer.events.GROUP_JOIN, ({ payload }) => {
  send({ type: 'group-join', memberId: payload.memberId, assignment: payload.memberAssignment });
});
subject.consumer.on(subject.consumer.events.CRASH, () => {
  send({ type: 'consumer-crash' });
});
const commit = subject.consumer.commitOffsets.bind(subject.consumer);

subject.consumer.commitOffsets = async (offsets) => {
  if (process.env.AUDIT_CRASH_BEFORE_OFFSET === 'true') {
    send({ type: 'before-offset', offsets });
    // Deliberately hold the real post-DB/pre-broker window until the parent kills this process.
    await new Promise(() => {});
  }

  await commit(offsets);
  send({ type: 'offset-committed', offsets });
};
let stopping = false;

async function stop() {
  if (stopping) return;

  stopping = true;
  const deadline = setTimeout(() => process.exit(2), 35000);

  try {
    await subject.stop();
    await db.$disconnect();
    send({ type: 'stopped' });
    clearTimeout(deadline);
    process.disconnect();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
process.on('message', (message) => {
  if (message?.type === 'stop') void stop();
});
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
try {
  await subject.start();
  send({ type: 'started' });
} catch (error) {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
}
