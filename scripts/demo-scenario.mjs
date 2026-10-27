import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

/** The CLI demo and final-image smoke exercise the same public HTTP/Kafka contracts. */
export async function runScenario({ api, token, producer, topic, tenantId, programId }) {
  const base = '/api/v1/programs/' + programId;

  async function http(path, body, key = randomUUID()) {
    const response = await fetch(api + path, {
      method: body === undefined ? 'GET' : 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();

    assert.ok(response.ok, 'Unexpected HTTP ' + response.status + ': ' + JSON.stringify(result));
    assert.equal(result.success, true);

    return result.data;
  }
  const view = () => http('/api/v1/internal/programs/' + programId + '/reconciliation-view');

  async function send(type, revision, payload, expected = 'APPLIED') {
    const event = {
      eventId: randomUUID(),
      schemaVersion: 1,
      tenantId,
      programId,
      treasuryRevision: revision,
      occurredAt: new Date().toISOString(),
      type,
      payload,
    };

    await producer.send({
      topic,
      messages: [{ key: tenantId + ':' + programId, value: JSON.stringify(event) }],
    });
    const deadline = Date.now() + 30000;

    while (Date.now() < deadline) {
      const rows = await http(
        '/api/v1/internal/programs/' + programId + '/treasury-events?eventId=' + event.eventId,
      );

      if (rows.length) {
        assert.equal(rows[0].resultCode, expected);

        return event;
      }

      await setTimeout(50);
    }

    throw new Error('Timed out waiting for durable event ' + event.eventId);
  }
  async function snapshot(value, expected) {
    await send(
      'ProgramStateSnapshot',
      (BigInt(value.highestSeenTreasuryRevision) + 1n).toString(),
      {
        currency: value.currency,
        limit: value.limit,
        baseStateVersion: value.stateVersion,
        reservations: value.reservations,
      },
      expected,
    );
  }
  assert.equal(
    (await fetch(api + base + '/capacity', { signal: AbortSignal.timeout(10000) })).status,
    401,
  );
  await snapshot(await view());
  const before = await http(base + '/capacity');

  assert.equal(before.syncStatus, 'READY');
  assert.equal(before.currency, 'USD', 'This demonstration uses the seeded USD program');
  console.log('Initial available capacity:', before.available);

  const key = randomUUID(),
    input = { invoiceId: 'demo-' + randomUUID(), amount: '10.00', currency: 'USD' };
  const first = await http(base + '/reservations', input, key);
  const after = await http(base + '/capacity');

  assert.deepEqual(await http(base + '/reservations', input, key), first);
  assert.deepEqual(await http(base + '/capacity'), after);
  console.log('Same-key retry preserved reservation and state version:', first.id);

  const stale = await view();
  const fx = await http(base + '/reservations', {
    invoiceId: 'demo-' + randomUUID(),
    amount: '1250.50',
    currency: 'EUR',
  });

  assert.equal(fx.reservedAmount, '1375.55');
  await snapshot(stale, 'STATE_VERSION_CONFLICT');
  assert.equal((await http(base + '/reservations/' + fx.id)).status, 'ACTIVE');
  assert.equal((await http(base + '/capacity')).syncStatus, 'RECONCILIATION_REQUIRED');
  await snapshot(await view());
  assert.equal((await http(base + '/capacity')).syncStatus, 'READY');
  console.log('Stale snapshot preserved the FX reservation; fresh snapshot recovered READY.');

  const current = await view();

  // Reapply the actual limit: demonstrate delivery without changing an existing demo program's policy.
  await send('ProgramLimitUpdated', (BigInt(current.highestSeenTreasuryRevision) + 1n).toString(), {
    currency: current.currency,
    limit: current.limit,
  });
  for (const reservation of [first, fx]) {
    const releaseKey = randomUUID();
    const released = await http(
      base + '/reservations/' + reservation.id + '/release',
      {},
      releaseKey,
    );

    assert.equal(released.status, 'RELEASED');
    assert.equal(released.reservedAmount, reservation.reservedAmount);
    assert.deepEqual(
      await http(base + '/reservations/' + reservation.id + '/release', {}, releaseKey),
      released,
    );
  }

  const final = await http(base + '/capacity');

  assert.equal(final.reserved, before.reserved);
  assert.equal(final.available, before.available);
  console.log('USD/FX releases restored initial availability:', final.available);

  return { reservationIds: [first.id, fx.id] };
}
