import { createHash, randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { HttpException } from '@nestjs/common';
import { domainErrorCode } from '#constants/capacity-errors.constants.js';

export const MAX_MINOR = 9223372036854775807n;
export const MAX_ACTIVE = 1000;
export const MAX_EVENT_BYTES = 2 * 1024 * 1024;
export const scales = { USD: 2, EUR: 2, GBP: 2, JPY: 0, KWD: 3 } as const;
export const currencySchema = z.enum(['USD', 'EUR', 'GBP', 'JPY', 'KWD']);
export type Currency = z.infer<typeof currencySchema>;
export const uuid = z.string().uuid();
export const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
export const versionSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine((v) => BigInt(v) <= MAX_MINOR);
export const moneySchema = z
  .string()
  .max(24)
  .regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
export const reserveSchema = z
  .object({ invoiceId: identifier, amount: moneySchema, currency: currencySchema })
  .strict();
export type ReserveInput = z.infer<typeof reserveSchema>;
export type Principal = { tenantId: string; clientId: string; permissions: string[] };
export type Outcome = { status: number; body: Record<string, unknown> };

export class AppError extends HttpException {
  constructor(
    status: number,
    public code: string,
    message: string,
    requestId?: string,
  ) {
    super(
      {
        message: `${domainErrorCode(code, status)}: ${message}`,
        details: { reason: code, ...(requestId ? { requestId } : {}) },
      },
      status,
    );
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new AppError(status, code, message);
}
export function refusal(code: string, message: string, requestId: string, status = 409): Outcome {
  return { status, body: { code, message, requestId } };
}
export function parseMoney(value: string, currency: Currency, allowZero = false): bigint {
  if (!moneySchema.safeParse(value).success)
    return fail(400, 'INVALID_AMOUNT', 'Invalid decimal amount');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > scales[currency])
    return fail(400, 'INVALID_AMOUNT', 'Excess decimal places');
  const result =
    BigInt(whole!) * 10n ** BigInt(scales[currency]) +
    BigInt(fraction.padEnd(scales[currency], '0') || '0');
  if (result > MAX_MINOR || result < (allowZero ? 0n : 1n))
    return fail(400, 'INVALID_AMOUNT', 'Amount outside supported range');
  return result;
}
export function formatMoney(value: bigint, currency: Currency): string {
  const scale = scales[currency];
  const s = value.toString().padStart(scale + 1, '0');
  return scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
}
Decimal.set({ precision: 80 });
export const DIRECTION = 'PROGRAM_MAJOR_PER_INVOICE_MAJOR';
export function convert(amount: bigint, from: Currency, to: Currency, rate: string): bigint {
  if (!/^(0|[1-9]\d{0,19})(\.\d{1,18})?$/.test(rate) || !new Decimal(rate).isPositive())
    return fail(503, 'FX_UNAVAILABLE', 'Invalid FX quote');
  const result = BigInt(
    new Decimal(amount.toString())
      .mul(rate)
      .mul(new Decimal(10).pow(scales[to] - scales[from]))
      .ceil()
      .toFixed(0),
  );
  if (result < 1n || result > MAX_MINOR)
    return fail(400, 'AMOUNT_OVERFLOW', 'Converted amount outside supported range');
  return result;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function operationId(): string {
  return randomUUID();
}
