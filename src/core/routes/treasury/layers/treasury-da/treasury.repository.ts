import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, Reservation } from '#generated/prisma/client.js';
import { PrismaService } from '#core/providers/prisma/prisma.service.js';
import { TxScopeRepository } from '#core/providers/prisma/tx-scope-repository.js';
import type { Tx } from '#core/providers/prisma/financial-transaction.service.js';
import type { TreasuryEvent, Coordinates } from '../../types/treasury-event.types.js';
import { paginate } from '#helpers/paginate.js';
import type { TreasuryEventListQueryDto } from '#core/routes/capacity/dto/list-query.dto.js';

@Injectable()
export class TreasuryRepository extends TxScopeRepository<
  Prisma.TransactionClient['treasuryInbox']
> {
  private readonly source: string;

  constructor(
    prisma: PrismaService,
    config: ConfigService,
  ) {
    super(prisma, (client) => client.treasuryInbox);
    this.source = config.getOrThrow<string>('TREASURY_SOURCE');
  }

  requireReconciliation() {
    return this.client.program.updateMany({ data: { syncStatus: 'RECONCILIATION_REQUIRED' } });
  }

  events(tenantId: string, programId: string, query: TreasuryEventListQueryDto) {
    const where = {
      source: this.source,
      tenantId,
      programId,
      ...(query.eventId ? { eventId: query.eventId } : {}),
    };

    return paginate(
      (skip, take) =>
        this.$.findMany({ where, skip, take, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      () => this.$.count({ where }),
      query.page,
      query.perPage,
    );
  }

  quarantine(tx: Tx, c: Coordinates, raw: Buffer, reason: string) {
    return tx.treasuryQuarantine.upsert({
      where: { source_topic_partition_offset: { source: this.source, ...c } },
      create: {
        id: randomUUID(),
        source: this.source,
        ...c,
        rawBase64: raw.toString('base64'),
        reason,
      },
      update: {},
    });
  }

  claim(tx: Tx, event: TreasuryEvent, c: Coordinates, hash: string, revisionHash: string) {
    return tx.$executeRaw`INSERT INTO "TreasuryInbox" (
        "id","source","eventId","tenantId","programId","revision",
        "fingerprint","revisionFingerprint","topic","partition","offset","payload"
      ) VALUES (
        ${randomUUID()}::uuid,${this.source},${event.eventId},${event.tenantId},${event.programId}::uuid,
        ${BigInt(event.treasuryRevision)},${hash},${revisionHash},${c.topic},${c.partition},${c.offset},${JSON.stringify(event)}::jsonb
      ) ON CONFLICT ("source","eventId") DO NOTHING`;
  }

  event(tx: Tx, eventId: string) {
    return tx.treasuryInbox.findUniqueOrThrow({
      where: { source_eventId: { source: this.source, eventId } },
    });
  }

  finish(tx: Tx, id: string, code: string) {
    return tx.treasuryInbox.update({ where: { id }, data: { result: { code } } });
  }

  previousRevision(tx: Tx, tenantId: string, programId: string, revision: bigint, inboxId: string) {
    return tx.treasuryInbox.findFirst({
      where: { source: this.source, tenantId, programId, revision, id: { not: inboxId } },
    });
  }

  beginSnapshotRows(tx: Tx) {
    return tx.$executeRaw`SAVEPOINT snapshot_rows`;
  }

  rollbackSnapshotRows(tx: Tx) {
    return tx.$executeRaw`ROLLBACK TO SAVEPOINT snapshot_rows`;
  }

  restore(tx: Tx, r: Omit<Reservation, 'status' | 'closedAt' | 'fxRate'> & { fxRate: string }) {
    return tx.$executeRaw`INSERT INTO "Reservation" (
        "id","tenantId","programId","invoiceId","invoiceMinor","invoiceCurrency",
        "reservedMinor","fxRate","fxDirection","fxSource","fxAsOf","createdAt"
      ) VALUES (
        ${r.id}::uuid,${r.tenantId},${r.programId}::uuid,${r.invoiceId},${r.invoiceMinor},${r.invoiceCurrency},
        ${r.reservedMinor},${r.fxRate.toString()}::numeric,${r.fxDirection},${r.fxSource},${r.fxAsOf},${r.createdAt}
      ) ON CONFLICT DO NOTHING`;
  }

  closeAbsent(tx: Tx, tenantId: string, programId: string, ids: string[]) {
    return tx.reservation.updateMany({
      where: { tenantId, programId, status: 'ACTIVE', id: { notIn: ids } },
      data: { status: 'RECONCILED_CLOSED', closedAt: new Date() },
    });
  }

  lookupReservation(tx: Tx, tenantId: string, id: string, invoiceId: string) {
    return tx.reservation.findFirst({ where: { OR: [{ id }, { tenantId, invoiceId }] } });
  }
}
