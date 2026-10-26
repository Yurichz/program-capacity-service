import './runtime-env.mjs';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { Kafka, logLevel } from 'kafkajs';
import { token } from './dev.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const api = process.env.API_URL ?? 'http://localhost:3000';
const jwt = await token();
async function http(path, body) {
    const res = await fetch(`${api}${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() },
        body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await res.json();
    if (!res.ok)
        throw new Error(`${res.status}: ${JSON.stringify(result)}`);
    return result.data;
}
const base = `/api/v1/programs/${id}`;
const view = () => http(`/api/v1/internal/programs/${id}/reconciliation-view`);
const kafka = new Kafka({ clientId: 'treasury-demo', brokers: (process.env.KAFKA_BROKERS ?? 'localhost:19092').split(','), logLevel: logLevel.ERROR });
const producer = kafka.producer({ allowAutoTopicCreation: false });
await producer.connect();
async function waitFor(predicate) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        const v = await http(`${base}/capacity`);
        if (predicate(v))
            return v;
        await setTimeout(100);
    }
    throw new Error('Timed out waiting for durable treasury state');
}
async function send(type, revision, payload) {
    await producer.send({ topic: process.env.KAFKA_TOPIC ?? 'treasury.capacity.v1', messages: [{ key: `demo-tenant:${id}`, value: JSON.stringify({ eventId: randomUUID(), schemaVersion: 1,
                    type, tenantId: 'demo-tenant', programId: id, treasuryRevision: revision.toString(), occurredAt: new Date().toISOString(), payload }) }] });
}
async function snapshot(v) {
    await send('ProgramStateSnapshot', BigInt(v.highestSeenTreasuryRevision) + 1n, { currency: v.currency, limit: v.limit, baseStateVersion: v.stateVersion, reservations: v.reservations });
}
try {
    await snapshot(await view());
    await waitFor(v => v.syncStatus === 'READY');
    const beforeLimit = await view();
    await send('ProgramLimitUpdated', BigInt(beforeLimit.lastAppliedTreasuryRevision) + 1n, { currency: 'USD', limit: '10000000.00' });
    await waitFor(v => BigInt(v.stateVersion) > BigInt(beforeLimit.stateVersion));
    const stale = await view();
    const reservation = await http(`${base}/reservations`, { invoiceId: `demo-${randomUUID()}`, amount: '1250.50', currency: 'EUR' });
    console.log('Cross-currency reserve:', reservation);
    await snapshot(stale);
    await waitFor(v => v.syncStatus === 'RECONCILIATION_REQUIRED');
    console.log('Stale snapshot rejected; local reservation preserved.');
    await snapshot(await view());
    await waitFor(v => v.syncStatus === 'READY');
    console.log('Fresh snapshot restored READY.');
    console.log('Release:', await http(`${base}/reservations/${reservation.id}/release`, {}));
    console.log('Capacity:', await http(`${base}/capacity`));
}
finally {
    await producer.disconnect();
}
