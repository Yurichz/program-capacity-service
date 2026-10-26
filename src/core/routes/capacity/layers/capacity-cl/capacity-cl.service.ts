import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type Program } from '#generated/prisma/client.js';
import { CapacityRepository } from '../capacity-da/capacity.repository.js';
import { ConsumerHealth } from '#core/providers/kafka/consumer-health.provider.js';
import { FxRateProvider, validQuote } from '#core/providers/fx/fx-rate.provider.js';
import { reservationDto } from '#helpers/reservation.helpers.js';
import { type Principal, type Outcome, type ReserveInput, DIRECTION, MAX_ACTIVE, MAX_MINOR, convert, currencySchema, fail, fingerprint, formatMoney, parseMoney, refusal } from '#helpers/capacity.helpers.js';

import { PrismaService } from '#core/providers/prisma/prisma.service.js';
import { FinancialTransactionService, type Tx } from '#core/providers/prisma/financial-transaction.service.js';
@Injectable()
export class CapacityClService {
  constructor(readonly repository: CapacityRepository, readonly health: ConsumerHealth, readonly fx: FxRateProvider, private readonly transactions: FinancialTransactionService, private readonly prisma: PrismaService) {}
  async access(principal: Principal, id: string, permission: string): Promise<Program & { _count: { reservations: number } }> {
    const p = await this.repository.find(principal.tenantId, id);
    if (!p) return fail(404, 'NOT_FOUND', 'Program not found');
    if (!principal.permissions.includes(permission)) return fail(403, 'FORBIDDEN', 'Permission required');
    return p;
  }
  private replay(saved: { fingerprint: string; status: number | null; result: Prisma.JsonValue | null }, hash: string): Outcome | undefined {
    if (saved.fingerprint !== hash) return fail(409, 'IDEMPOTENCY_KEY_REUSED', 'Key already belongs to a different request');
    if (saved.status !== null && saved.result !== null) return { status: saved.status, body: saved.result as Record<string, unknown> };
    return undefined;
  }
  private async command(principal: Principal, id: string, key: string, hash: string, work: (tx: Tx, p: Program) => Promise<Outcome>): Promise<Outcome> {
    return this.transactions.run( async tx => {
      await this.repository.claim(tx, principal, key, id, hash);
      const saved = await this.repository.request(tx, principal, key);
      const replay = this.replay(saved, hash);
      if (replay) return replay;
      const p = await this.repository.lock(tx, principal.tenantId, id);
      if (!p) return fail(404, 'NOT_FOUND', 'Program not found');
      const result = await work(tx, p);
      await this.repository.saveResult(tx, principal, key, result);
      return result;
    });
  }
  async reserve(principal: Principal, id: string, input: ReserveInput, key: string, requestId: string): Promise<Outcome> {
    const initial = await this.access(principal, id, 'reservations:write');
    const amount = parseMoney(input.amount, input.currency);
    const hash = fingerprint({ method: 'POST', programId: id, action: 'reserve', ...input, amount: formatMoney(amount, input.currency) });
    const saved = await this.repository.saved(principal, key);
    if (saved) { const replay = this.replay(saved, hash); if (replay) return replay; }
    const currency = currencySchema.parse(initial.currency);
    const quote = input.currency === currency ? { rate: '1', source: 'IDENTITY', direction: DIRECTION, asOf: new Date() } : await this.fx.quote(input.currency, currency);
    const held = convert(amount, input.currency, currency, quote.rate);
    return this.command(principal, id, key, hash, async (tx, p) => {
      if (!this.health.connected || p.syncStatus !== 'READY') return refusal('RECONCILIATION_REQUIRED', 'A fresh treasury snapshot is required', requestId);
      if (!validQuote(quote)) return fail(503, 'FX_UNAVAILABLE', 'FX quote expired');
      const existing = await this.repository.invoice(tx, principal.tenantId, input.invoiceId);
      if (existing) return refusal('DUPLICATE_INVOICE', 'Invoice has already been financed', requestId);
      if (held > p.limitMinor - p.reservedMinor) return refusal('INSUFFICIENT_CAPACITY', 'Insufficient capacity', requestId);
      if (await this.repository.activeCount(tx, principal.tenantId, id) >= MAX_ACTIVE)
        return refusal('RESERVATION_LIMIT', 'Maximum active reservations reached', requestId);
      if (p.stateVersion === MAX_MINOR) return refusal('VERSION_EXHAUSTED', 'Program version exhausted', requestId);
      const rid = randomUUID();
      const inserted = await this.repository.insert(tx, { id: rid, tenantId: principal.tenantId, programId: id, invoiceId: input.invoiceId,
        invoiceMinor: amount, invoiceCurrency: input.currency, reservedMinor: held, fxRate: quote.rate, fxDirection: quote.direction, fxSource: quote.source, fxAsOf: quote.asOf });
      if (!inserted) return refusal('DUPLICATE_INVOICE', 'Invoice has already been financed', requestId);
      const updated = await this.repository.updateProgram(tx, p, { reservedMinor: p.reservedMinor + held, stateVersion: p.stateVersion + 1n });
      await this.repository.movement(tx, updated, held, 0n, 'RESERVE', principal.clientId, requestId, rid);
      const r = await this.repository.created(tx, { id: rid, tenantId: principal.tenantId, programId: id });
      return { status: 201, body: reservationDto(r, currency) };
    });
  }
  async release(principal: Principal, id: string, rid: string, key: string, requestId: string): Promise<Outcome> {
    await this.access(principal, id, 'reservations:write');
    const hash = fingerprint({ method: 'POST', programId: id, reservationId: rid, action: 'release', body: {} });
    return this.command(principal, id, key, hash, async (tx, p) => {
      const r = await this.repository.reservation(tx, principal.tenantId, id, rid);
      if (!r) return refusal('NOT_FOUND', 'Reservation not found', requestId, 404);
      if (r.status !== 'ACTIVE') return { status: 200, body: reservationDto(r, currencySchema.parse(p.currency)) };
      if (p.stateVersion === MAX_MINOR) return refusal('VERSION_EXHAUSTED', 'Program version exhausted', requestId);
      const closed = await this.repository.close(tx, { id: rid, tenantId: principal.tenantId, programId: id });
      const updated = await this.repository.updateProgram(tx, p, { reservedMinor: p.reservedMinor - r.reservedMinor, stateVersion: p.stateVersion + 1n });
      await this.repository.movement(tx, updated, -r.reservedMinor, 0n, 'RELEASE', principal.clientId, requestId, rid);
      return { status: 200, body: reservationDto(closed, currencySchema.parse(p.currency)) };
    });
  }
  async view(principal: Principal, id: string) {
    await this.access(principal, id, 'treasury:reconcile');
    return this.prisma.$tx(async tx => {
      const { program: p, reservations } = await this.repository.consistentView(tx, principal.tenantId, id);
      return { programId: id, currency: p.currency, limit: formatMoney(p.limitMinor, currencySchema.parse(p.currency)), stateVersion: p.stateVersion.toString(),
        lastAppliedTreasuryRevision: p.lastAppliedTreasuryRevision.toString(), highestSeenTreasuryRevision: p.highestSeenTreasuryRevision.toString(),
        reservations: reservations.map(r => reservationDto(r, currencySchema.parse(p.currency))) };
    }, { isolationLevel: 'RepeatableRead', timeout: 10000 });
  }
}
