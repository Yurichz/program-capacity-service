import { z } from 'zod';
import {
  DIRECTION,
  MAX_ACTIVE,
  currencySchema,
  identifier,
  moneySchema,
  uuid,
  versionSchema,
} from '#helpers/capacity.helpers.js';

const fxSchema = z
  .object({
    rate: z.string().max(40),
    direction: z.literal(DIRECTION),
    source: identifier,
    asOf: z.iso.datetime(),
  })
  .strict();
export const snapshotRowSchema = z
  .object({
    id: uuid,
    programId: uuid,
    invoiceId: identifier,
    amount: moneySchema,
    currency: currencySchema,
    reservedAmount: moneySchema,
    programCurrency: currencySchema,
    fx: fxSchema,
    status: z.literal('ACTIVE'),
    createdAt: z.iso.datetime(),
    closedAt: z.null(),
  })
  .strict();
const envelope = {
  eventId: uuid,
  schemaVersion: z.literal(1),
  tenantId: identifier,
  programId: uuid,
  treasuryRevision: versionSchema.refine((v) => BigInt(v) > 0n),
  occurredAt: z.iso.datetime(),
};
export const eventSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...envelope,
      type: z.literal('ProgramLimitUpdated'),
      payload: z.object({ currency: currencySchema, limit: moneySchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal('ProgramStateSnapshot'),
      payload: z
        .object({
          currency: currencySchema,
          limit: moneySchema,
          baseStateVersion: versionSchema,
          reservations: z.array(snapshotRowSchema).max(MAX_ACTIVE),
        })
        .strict(),
    })
    .strict(),
]);
export type TreasuryEvent = z.infer<typeof eventSchema>;
export type Coordinates = { topic: string; partition: number; offset: string };
export type TreasuryResult = { code: string; eventId?: string; programId?: string };
export type Target = { tenantId: string; programId: string; revision?: bigint };
