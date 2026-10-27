import assert from 'node:assert/strict';
import { Kafka, logLevel } from 'kafkajs';
import { runScenario } from './demo-scenario.mjs';
import { waitFor } from './test-support.mjs';

const api = process.env.API_URL;

assert.ok(api && process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD);
for (const route of ['/api/v1/health', '/api/v1/health/ready', '/docs'])
  assert.equal((await fetch(api + route, { signal: AbortSignal.timeout(10000) })).status, 401);

const login = await fetch(api + '/api/v1/auth/sign-in', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD }),
  signal: AbortSignal.timeout(10000),
});

assert.equal(login.status, 200);
const {
  data: { accessToken },
} = await login.json();

await waitFor(
  () =>
    fetch(api + '/api/v1/health/ready', {
      headers: { authorization: 'Bearer ' + accessToken },
      signal: AbortSignal.timeout(10000),
    }),
  (response) => response.status === 200,
  'authenticated consumer readiness',
);
const producer = new Kafka({
  clientId: 'image-smoke',
  brokers: process.env.KAFKA_BROKERS.split(','),
  logLevel: logLevel.ERROR,
}).producer({ allowAutoTopicCreation: false });

try {
  await producer.connect();
  await runScenario({
    api,
    token: accessToken,
    producer,
    topic: process.env.KAFKA_TOPIC,
    tenantId: process.env.DEMO_TENANT_ID,
    programId: process.env.DEMO_PROGRAM_ID,
  });
  console.log('Final-image smoke passed.');
} finally {
  await producer.disconnect();
}
