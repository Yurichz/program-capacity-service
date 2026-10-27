import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

export const POSTGRES_IMAGE =
  'postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3';
export const KAFKA_IMAGE =
  'apache/kafka:4.1.1@sha256:0bc1bb2478f45b6cea78864df86acdc11e8df2c5172477819a4d12942cbe5d40';

export function testDatabaseUrl(url) {
  assert.match(
    decodeURIComponent(new URL(url).pathname),
    /^\/app_test_[a-z0-9_]+$/,
    'Only an owned app_test_* database is allowed',
  );

  return url;
}

export function prisma(args, env) {
  testDatabaseUrl(env.DATABASE_URL);
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], {
    env,
    stdio: 'inherit',
  });
}

export async function waitFor(read, accept, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await setTimeout(50);
  }
  throw new Error('Timed out waiting for ' + description);
}

export function kafkaEnvironment() {
  return {
    KAFKA_NODE_ID: '1',
    KAFKA_PROCESS_ROLES: 'broker,controller',
    KAFKA_LISTENERS: 'PLAINTEXT://:9092,CONTROLLER://:9093',
    KAFKA_ADVERTISED_LISTENERS: 'PLAINTEXT://kafka:9092',
    KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: 'PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT',
    KAFKA_CONTROLLER_LISTENER_NAMES: 'CONTROLLER',
    KAFKA_CONTROLLER_QUORUM_VOTERS: '1@kafka:9093',
    KAFKA_INTER_BROKER_LISTENER_NAME: 'PLAINTEXT',
    KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: '1',
    KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: '1',
    KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: '1',
    KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: '0',
    KAFKA_MESSAGE_MAX_BYTES: '3145728',
    KAFKA_REPLICA_FETCH_MAX_BYTES: '4194304',
    CLUSTER_ID: 'MkU3OEVBNTcwNTJENDM2Qk',
  };
}

export async function stopOwned(containers, network) {
  const results = await Promise.allSettled(
    [...containers].reverse().map((container) => container.stop()),
  );
  if (network) results.push(...(await Promise.allSettled([network.stop()])));
  for (const result of results)
    if (result.status === 'rejected') {
      console.error('Owned test resource cleanup failed:', result.reason?.message);
      process.exitCode = 1;
    }
}
