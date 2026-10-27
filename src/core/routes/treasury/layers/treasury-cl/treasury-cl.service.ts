import { TextDecoder } from 'node:util';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Program } from '#generated/prisma/client.js';
import {
  FinancialTransactionService,
  type Tx,
} from '#core/providers/prisma/financial-transaction.service.js';
import { CapacityRepository } from '#core/routes/capacity/layers/capacity-da/capacity.repository.js';
import { TreasuryRepository } from '../treasury-da/treasury.repository.js';
import {
  MAX_EVENT_BYTES,
  MAX_MINOR,
  convert,
  fingerprint,
  identifier,
  parseMoney,
  uuid,
} from '#helpers/capacity.helpers.js';
import {
  eventSchema,
  snapshotRowSchema,
  type TreasuryEvent,
  type Coordinates,
  type TreasuryResult,
  type Target,
} from '../../types/treasury-event.types.js';

@Injectable()
export class TreasuryClService {
  private readonly source: string;

  constructor(
    readonly repo: CapacityRepository,
    readonly inbox: TreasuryRepository,
    readonly transactions: FinancialTransactionService,
    config: ConfigService,
  ) {
    this.source = config.getOrThrow<string>('TREASURY_SOURCE');
  }

  async requireReconciliation(): Promise<void> {
    // Single runtime: on startup or loss of consumer readiness, require a new snapshot.
    // Financial state is untouched; updates take PostgreSQL row locks like other writers.
    await this.inbox.requireReconciliation();
  }

  private async quarantine(
    tx: Tx,
    c: Coordinates,
    raw: Buffer,
    reason: string,
    targets: Target[],
  ): Promise<TreasuryResult> {
    await this.inbox.quarantine(tx, c, raw, reason);
    const unique = new Map<string, Target>();
    for (const target of targets) {
      const key = `${target.tenantId}:${target.programId}`;
      const old = unique.get(key);
      unique.set(key, {
        ...target,
        revision: (old?.revision ?? 0n) > (target.revision ?? 0n) ? old!.revision : target.revision,
      });
    }
    for (const target of [...unique.values()].sort((a, b) =>
      a.programId.localeCompare(b.programId))) {
      const p = await this.repo.lock(tx, target.tenantId, target.programId);
      if (p)
        await this.repo.updateProgram(tx, p, {
          syncStatus: 'RECONCILIATION_REQUIRED',
          highestSeenTreasuryRevision:
            target.revision && target.revision > p.highestSeenTreasuryRevision
              ? target.revision
              : p.highestSeenTreasuryRevision,
        });
    }

    return { code: reason };
  }

  async process(raw: Buffer, key: string | null, c: Coordinates): Promise<TreasuryResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      parsed = null;
    }
    const candidate = z.object({ tenantId: identifier, programId: uuid }).safeParse(parsed);
    const validated = eventSchema.safeParse(parsed);
    const targets: Target[] = validated.success
      ? [
        {
          tenantId: validated.data.tenantId,
          programId: validated.data.programId,
          revision: BigInt(validated.data.treasuryRevision),
        },
      ]
      : candidate.success
        ? [candidate.data]
        : [];
    if (raw.length > MAX_EVENT_BYTES || !validated.success)
      return this.transactions.run((tx) => this.quarantine(tx, c, raw, 'INVALID_EVENT', targets));
    const event = validated.data;
    const revision = BigInt(event.treasuryRevision);
    if (key !== `${event.tenantId}:${event.programId}`)
      return this.transactions.run((tx) =>
        this.quarantine(tx, c, raw, 'INVALID_PARTITION_KEY', [{ ...event, revision }]));
    const hash = fingerprint(event);
    const revisionHash = fingerprint({
      type: event.type,
      tenantId: event.tenantId,
      programId: event.programId,
      revision: event.treasuryRevision,
      payload: event.payload,
    });
    const outcome = await this.transactions.run(async (tx) => {
      const inserted = await this.inbox.claim(tx, event, c, hash, revisionHash);
      const inbox = await this.inbox.event(tx, event.eventId);
      if (!inserted) {
        if (inbox.fingerprint === hash) return inbox.result as TreasuryResult;

        return this.quarantine(tx, c, raw, 'EVENT_ID_CONFLICT', [
          { ...event, revision },
          { tenantId: inbox.tenantId, programId: inbox.programId },
        ]);
      }
      const finish = async (code: string): Promise<TreasuryResult> => {
        const result = { code };
        await this.inbox.finish(tx, inbox.id, code);

        return result;
      };
      let p = await this.repo.lock(tx, event.tenantId, event.programId);
      if (!p) return finish('UNKNOWN_PROGRAM');
      const previous = await this.inbox.previousRevision(
        tx,
        event.tenantId,
        p.id,
        revision,
        inbox.id,
      );
      const oldHighest = p.highestSeenTreasuryRevision;
      p = await this.repo.updateProgram(tx, p, {
        highestSeenTreasuryRevision: revision > oldHighest ? revision : oldHighest,
      });
      const reject = async (code: string) => {
        await this.repo.updateProgram(tx, p!, { syncStatus: 'RECONCILIATION_REQUIRED' });

        return finish(code);
      };
      if (previous && previous.revisionFingerprint !== revisionHash) {
        await this.quarantine(tx, c, raw, 'REVISION_CONFLICT', []);

        return reject('REVISION_CONFLICT');
      }
      if (revision <= p.lastAppliedTreasuryRevision) return finish('STALE');
      if (previous) return reject('REVISION_REUSED');
      if (event.payload.currency !== p.currency) return reject('CURRENCY_CONFLICT');
      let limit: bigint;
      try {
        limit = parseMoney(event.payload.limit, event.payload.currency, true);
      } catch {
        return reject('INVALID_MONEY');
      }
      if (p.stateVersion === MAX_MINOR) return reject('VERSION_EXHAUSTED');
      if (event.type === 'ProgramLimitUpdated') {
        if (p.syncStatus !== 'READY' || revision !== p.lastAppliedTreasuryRevision + 1n)
          return reject('REVISION_GAP');
        const updated = await this.repo.updateProgram(tx, p, {
          limitMinor: limit,
          stateVersion: p.stateVersion + 1n,
          lastAppliedTreasuryRevision: revision,
          lastTreasuryAt: new Date(),
        });
        await this.repo.movement(
          tx,
          updated,
          0n,
          limit - p.limitMinor,
          'TREASURY_LIMIT',
          this.source,
          event.eventId,
        );

        return finish('APPLIED');
      }
      if (revision <= oldHighest) return reject('RECOVERY_REVISION_TOO_LOW');
      if (BigInt(event.payload.baseStateVersion) !== p.stateVersion)
        return reject('STATE_VERSION_CONFLICT');
      const prepared = await this.prepareSnapshot(tx, p, event);
      if (typeof prepared === 'string') return reject(prepared);
      // Validate every row before any financial mutation. Invoice conflicts can still
      // race across programs; ON CONFLICT is checked inside a savepoint below.
      await this.inbox.beginSnapshotRows(tx);
      for (const row of prepared.rows) {
        if (row.existing) continue;
        const r = row.input;
        const count = await this.inbox.restore(tx, {
          id: r.id,
          tenantId: p.tenantId,
          programId: p.id,
          invoiceId: r.invoiceId,
          invoiceMinor: row.invoiceMinor,
          invoiceCurrency: r.currency,
          reservedMinor: row.held,
          fxRate: r.fx.rate,
          fxDirection: r.fx.direction,
          fxSource: r.fx.source,
          fxAsOf: new Date(r.fx.asOf),
          createdAt: new Date(r.createdAt),
        });
        if (!count) {
          await this.inbox.rollbackSnapshotRows(tx);

          return reject('RESERVATION_CONFLICT');
        }
      }
      await this.inbox.closeAbsent(
        tx,
        p.tenantId,
        p.id,
        prepared.rows.map((r) => r.input.id),
      );
      const updated = await this.repo.updateProgram(tx, p, {
        limitMinor: limit,
        reservedMinor: prepared.total,
        stateVersion: p.stateVersion + 1n,
        lastAppliedTreasuryRevision: revision,
        syncStatus: 'READY',
        lastTreasuryAt: new Date(),
      });
      await this.repo.movement(
        tx,
        updated,
        prepared.total - p.reservedMinor,
        limit - p.limitMinor,
        'TREASURY_SNAPSHOT',
        this.source,
        event.eventId,
      );

      return finish('APPLIED');
    });

    return { ...outcome, eventId: event.eventId, programId: event.programId };
  }

  private async prepareSnapshot(
    tx: Tx,
    p: Program,
    event: Extract<TreasuryEvent, { type: 'ProgramStateSnapshot' }>,
  ) {
    const rows: {
      input: z.infer<typeof snapshotRowSchema>;
      invoiceMinor: bigint;
      held: bigint;
      existing: boolean;
    }[] = [];
    const ids = new Set<string>();
    const invoices = new Set<string>();
    let total = 0n;
    // Normalize local copies so inbox payloads and fingerprints retain the original UUID casing.
    const reservations = event.payload.reservations
      .map((row) => ({ ...row, id: row.id.toLowerCase(), programId: row.programId.toLowerCase() }))
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const row of reservations) {
      if (ids.has(row.id) || invoices.has(row.invoiceId)) return 'DUPLICATE_SNAPSHOT_ROW';
      ids.add(row.id);
      invoices.add(row.invoiceId);
      if (row.programId !== p.id || row.programCurrency !== p.currency)
        return 'CURRENCY_OR_PROGRAM_CONFLICT';
      let invoiceMinor: bigint;
      let held: bigint;
      try {
        invoiceMinor = parseMoney(row.amount, row.currency);
        held = parseMoney(row.reservedAmount, row.programCurrency);
        if (convert(invoiceMinor, row.currency, row.programCurrency, row.fx.rate) !== held)
          return 'INVALID_FX_AMOUNT';
        if (row.currency === row.programCurrency && !new Decimal(row.fx.rate).equals(1))
          return 'INVALID_IDENTITY_FX';
      } catch {
        return 'INVALID_MONEY';
      }
      total += held;
      if (total > MAX_MINOR) return 'AMOUNT_OVERFLOW';
      const existing = await this.inbox.lookupReservation(tx, p.tenantId, row.id, row.invoiceId);
      if (
        existing &&
        (existing.status !== 'ACTIVE' ||
          existing.tenantId !== p.tenantId ||
          existing.programId !== p.id ||
          existing.id !== row.id ||
          existing.invoiceId !== row.invoiceId ||
          existing.invoiceMinor !== invoiceMinor ||
          existing.invoiceCurrency !== row.currency ||
          existing.reservedMinor !== held ||
          !new Decimal(existing.fxRate.toString()).equals(row.fx.rate) ||
          existing.fxDirection !== row.fx.direction ||
          existing.fxSource !== row.fx.source ||
          existing.fxAsOf.getTime() !== new Date(row.fx.asOf).getTime() ||
          existing.createdAt.getTime() !== new Date(row.createdAt).getTime())
      )
        return 'RESERVATION_CONFLICT';
      rows.push({ input: row, invoiceMinor, held, existing: !!existing });
    }

    return { rows, total };
  }
}
