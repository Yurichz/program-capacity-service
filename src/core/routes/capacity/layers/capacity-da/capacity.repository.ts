import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { Prisma, type Program } from '#generated/prisma/client.js';
import { PrismaService } from '#core/providers/prisma/prisma.service.js';
import { TxScopeRepository } from '#core/providers/prisma/tx-scope-repository.js';
import type { Tx } from '#core/providers/prisma/financial-transaction.service.js';
import type { Currency, Principal, Outcome } from '#helpers/capacity.helpers.js';
import { paginate } from '#helpers/paginate.js';
import type { ListQueryDto, ReservationListQueryDto } from '../../dto/list-query.dto.js';

@Injectable()
export class CapacityRepository extends TxScopeRepository<Prisma.TransactionClient['program']> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.program);
  }

  find(tenantId: string, id: string) {
    return this.$.findUnique({
      where: { tenantId_id: { tenantId, id } },
      include: { _count: { select: { reservations: { where: { status: 'ACTIVE' } } } } },
    });
  }

  programs(tenantId: string, query: ListQueryDto) {
    const where = { tenantId };

    return paginate(
      (skip, take) =>
        this.$.findMany({
          where,
          skip,
          take,
          orderBy: { id: 'asc' },
          include: { _count: { select: { reservations: { where: { status: 'ACTIVE' } } } } },
        }),
      () => this.$.count({ where }),
      query.page,
      query.perPage,
    );
  }

  reservations(tenantId: string, programId: string, query: ReservationListQueryDto) {
    const where: Prisma.ReservationWhereInput = {
      tenantId,
      programId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.currency ? { invoiceCurrency: query.currency } : {}),
      ...(query.invoiceId ? { invoiceId: { contains: query.invoiceId, mode: 'insensitive' } } : {}),
    };

    return paginate(
      (skip, take) =>
        this.client.reservation.findMany({
          where,
          skip,
          take,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      () => this.client.reservation.count({ where }),
      query.page,
      query.perPage,
    );
  }

  movements(tenantId: string, programId: string, query: ListQueryDto) {
    const where = { tenantId, programId };

    return paginate(
      (skip, take) =>
        this.client.capacityMovement.findMany({
          where,
          skip,
          take,
          orderBy: { stateVersion: 'desc' },
        }),
      () => this.client.capacityMovement.count({ where }),
      query.page,
      query.perPage,
    );
  }

  async lock(tx: Tx, tenantId: string, id: string): Promise<Program | null> {
    const rows = await tx.$queryRaw<
      unknown[]
    >`SELECT "id" FROM "Program" WHERE "tenantId" = ${tenantId} AND "id" = ${id}::uuid FOR UPDATE`;

    z.array(z.object({ id: z.string().uuid() })).parse(rows);

    return tx.program.findUnique({ where: { tenantId_id: { tenantId, id } } });
  }

  async movement(
    tx: Tx,
    p: Program,
    reservedDelta: bigint,
    limitDelta: bigint,
    reason: string,
    actor: string,
    operationId: string,
    reservationId?: string,
  ) {
    await tx.capacityMovement.create({
      data: {
        id: randomUUID(),
        tenantId: p.tenantId,
        programId: p.id,
        reservationId,
        reservedDelta,
        limitDelta,
        reason,
        actor,
        operationId,
        stateVersion: p.stateVersion,
      },
    });
  }

  async saved(principal: Principal, key: string) {
    return this.client.idempotencyRequest.findUnique({
      where: {
        tenantId_clientId_key: { tenantId: principal.tenantId, clientId: principal.clientId, key },
      },
    });
  }

  async claim(
    tx: Tx,
    principal: Principal,
    key: string,
    programId: string,
    hash: string,
  ): Promise<void> {
    await tx.$executeRaw`INSERT INTO "IdempotencyRequest" ("tenantId", "clientId", "key", "programId", "fingerprint")
      VALUES (${principal.tenantId}, ${principal.clientId}, ${key}, ${programId}::uuid, ${hash}) ON CONFLICT DO NOTHING`;
  }

  request(tx: Tx, principal: Principal, key: string) {
    return tx.idempotencyRequest.findUniqueOrThrow({
      where: {
        tenantId_clientId_key: { tenantId: principal.tenantId, clientId: principal.clientId, key },
      },
    });
  }

  async saveResult(tx: Tx, principal: Principal, key: string, result: Outcome) {
    await tx.idempotencyRequest.update({
      where: {
        tenantId_clientId_key: { tenantId: principal.tenantId, clientId: principal.clientId, key },
      },
      data: { status: result.status, result: result.body as Prisma.InputJsonObject },
    });
  }

  updateProgram(
    tx: Tx,
    program: Pick<Program, 'id' | 'tenantId'>,
    data: Prisma.ProgramUpdateInput,
  ) {
    return tx.program.update({
      where: { tenantId_id: { id: program.id, tenantId: program.tenantId } },
      data,
    });
  }

  invoice(tx: Tx, tenantId: string, invoiceId: string) {
    return tx.reservation.findUnique({ where: { tenantId_invoiceId: { tenantId, invoiceId } } });
  }

  activeCount(tx: Tx, tenantId: string, programId: string) {
    return tx.reservation.count({ where: { tenantId, programId, status: 'ACTIVE' } });
  }

  reservation(tx: Tx, tenantId: string, programId: string, id: string) {
    return tx.reservation.findFirst({ where: { tenantId, programId, id } });
  }

  readReservation(tenantId: string, programId: string, id: string) {
    return this.client.reservation.findFirst({ where: { tenantId, programId, id } });
  }

  created(tx: Tx, scope: { id: string; tenantId: string; programId: string }) {
    return tx.reservation.findUniqueOrThrow({ where: scope });
  }

  close(tx: Tx, scope: { id: string; tenantId: string; programId: string }) {
    return tx.reservation.update({
      where: { ...scope, status: 'ACTIVE' },
      data: { status: 'RELEASED', closedAt: new Date() },
    });
  }

  insert(
    tx: Tx,
    r: {
      id: string;
      tenantId: string;
      programId: string;
      invoiceId: string;
      invoiceMinor: bigint;
      invoiceCurrency: Currency;
      reservedMinor: bigint;
      fxRate: string;
      fxDirection: string;
      fxSource: string;
      fxAsOf: Date;
    },
  ) {
    return tx.$executeRaw`INSERT INTO "Reservation" (
        "id","tenantId","programId","invoiceId","invoiceMinor","invoiceCurrency",
        "reservedMinor","fxRate","fxDirection","fxSource","fxAsOf"
      ) VALUES (
        ${r.id}::uuid,${r.tenantId},${r.programId}::uuid,${r.invoiceId},${r.invoiceMinor},${r.invoiceCurrency},
        ${r.reservedMinor},${r.fxRate}::numeric,${r.fxDirection},${r.fxSource},${r.fxAsOf}
      ) ON CONFLICT ("tenantId","invoiceId") DO NOTHING`;
  }

  async consistentView(tx: Tx, tenantId: string, id: string) {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const program = await tx.program.findUniqueOrThrow({
      where: { tenantId_id: { tenantId, id } },
    });
    const reservations = await tx.reservation.findMany({
      where: { tenantId, programId: id, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
    });

    return { program, reservations };
  }
}
