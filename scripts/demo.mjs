import './runtime-env.mjs';
import { Kafka, logLevel } from 'kafkajs';
import { token } from './dev.mjs';
import { runScenario } from './demo-scenario.mjs';

const id = process.env.DEMO_PROGRAM_ID ?? '11111111-1111-4111-8111-111111111111';
const tenantId = process.env.DEMO_TENANT_ID ?? 'demo-tenant';
const api = process.env.API_URL ?? 'http://localhost:3000';
const jwt = await token(tenantId);
const kafka = new Kafka({
  clientId: 'treasury-demo',
  brokers: (process.env.KAFKA_BROKERS ?? 'localhost:19092').split(','),
  logLevel: logLevel.ERROR,
});
const producer = kafka.producer({ allowAutoTopicCreation: false });

try {
  await producer.connect();
  await runScenario({
    api,
    token: jwt,
    producer,
    tenantId,
    programId: id,
    topic: process.env.KAFKA_TOPIC ?? 'treasury.capacity.v1',
  });
} finally {
  await producer.disconnect();
}
