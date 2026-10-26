import test from 'node:test';
import assert from 'node:assert/strict';
import { minor, money, utilization } from '../src/money.ts';
test('UI money retains large strings, scales, signed movements and bounded visual ratios', () => {
  assert.equal(minor('90071992547409.93', 'USD'), 9007199254740993n);
  assert.equal(money('90071992547409.93', 'USD', true), 'USD 90,071,992,547,409.93');
  assert.equal(minor('123', 'JPY'), 123n);
  assert.equal(minor('1.234', 'KWD'), 1234n);
  assert.equal(minor('-12.34', 'USD'), -1234n);
  assert.equal(money('-12.34', 'USD'), '-12.34');
  assert.throws(() => minor('1.001', 'EUR'));
  assert.throws(() => minor('1.1', 'JPY'));
  assert.throws(() => minor('92233720368547758.08', 'USD'));
  assert.equal(utilization('0.00', '0.00', 'USD'), 0);
  assert.equal(utilization('1.00', '0.00', 'USD'), 100);
  assert.equal(utilization('150.00', '100.00', 'USD'), 100);
  assert.equal(utilization('1.23', '100.00', 'USD'), 1.23);
});
