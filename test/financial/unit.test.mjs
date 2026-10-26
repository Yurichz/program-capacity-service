import { FxRateProvider } from '../../dist/core/providers/fx/fx-rate.provider.js';
import { validQuote } from '../../dist/core/providers/fx/fx-rate.provider.js';
import { describe, expect, test } from '@jest/globals';
import {
  convert,
  DIRECTION,
  fingerprint,
  formatMoney,
  MAX_MINOR,
  parseMoney,
  reserveSchema,
} from '../../dist/helpers/capacity.helpers.js';
import { validateEnvironment } from '../../dist/config/environment.config.js';
import { eventSchema } from '../../dist/core/routes/treasury/types/treasury-event.types.js';
describe('money, FX, schemas and canonical fingerprints', () => {
  test.each([
    ['JPY', '123', 123n],
    ['USD', '1.23', 123n],
    ['KWD', '1.234', 1234n],
  ])('%s scale', (currency, value, minor) => {
    expect(parseMoney(value, currency)).toBe(minor);
    expect(formatMoney(minor, currency)).toBe(value);
  });
  test.each([
    '0',
    '-1',
    '1e2',
    'NaN',
    'Infinity',
    '01',
    ' 1',
    '1.001',
    '1.',
    '1,00',
    '92233720368547758.08',
  ])('rejects invalid money %s', (value) => {
    expect(() => parseMoney(value, 'USD')).toThrow();
  });
  test('zero limits, scale overflow and BIGINT bounds', () => {
    expect(parseMoney('0', 'USD', true)).toBe(0n);
    expect(formatMoney(0n, 'USD')).toBe('0.00');
    expect(parseMoney('92233720368547758.07', 'USD')).toBe(MAX_MINOR);
    expect(() => parseMoney('1.0', 'JPY')).toThrow();
  });
  test('FX rounds toward capacity consumption and handles different scales', () => {
    expect(convert(1n, 'USD', 'USD', '1.001')).toBe(2n);
    expect(convert(100n, 'JPY', 'USD', '0.0067')).toBe(67n);
    expect(convert(1001n, 'KWD', 'USD', '3.25')).toBe(326n);
    expect(convert(1n, 'USD', 'KWD', '1')).toBe(10n);
    for (const rate of ['0', '-1', 'NaN', '1e9', '0.0000000000000000001'])
      expect(() => convert(1n, 'USD', 'USD', rate)).toThrow();
    expect(() => convert(MAX_MINOR, 'USD', 'USD', '2')).toThrow();
  });
  test('demo quotes use controlled time; expiry and future timestamps fail', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const fx = new FxRateProvider(() => now);
    const quote = await fx.quote('EUR', 'USD');
    expect(quote.direction).toBe(DIRECTION);
    expect(validQuote(quote, now)).toBe(true);
    expect(validQuote(quote, new Date(+now + 60001))).toBe(false);
    expect(validQuote(quote, new Date(+now - 1))).toBe(false);
    expect((await fx.quote('USD', 'USD')).rate).toBe('1');
    await expect(fx.quote('USD', 'EUR')).rejects.toThrow();
  });
  test('fingerprints are order independent and retain falsy values', () => {
    expect(fingerprint({ a: 0, b: false, c: '' })).toBe(fingerprint({ c: '', b: false, a: 0 }));
    expect(fingerprint({ a: 0 })).not.toBe(fingerprint({ a: null }));
    expect(fingerprint({ method: 'POST', id: 'a' })).not.toBe(
      fingerprint({ method: 'POST', id: 'b' }),
    );
  });
  test('boundaries reject unknown fields and invalid env/events', () => {
    expect(
      reserveSchema.safeParse({ invoiceId: 'i', amount: '1', currency: 'USD', tenantId: 'foreign' })
        .success,
    ).toBe(false);
    expect(
      reserveSchema.safeParse({ invoiceId: 'i', amount: '1e2', currency: 'USD' }).success,
    ).toBe(false);
    expect(() => validateEnvironment({})).toThrow();
    expect(eventSchema.safeParse({ type: 'ProgramStateSnapshot' }).success).toBe(false);
  });
});
