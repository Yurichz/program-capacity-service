import { Injectable } from '@nestjs/common';
import type { Program } from '#generated/prisma/client.js';
import { CapacityRepository } from '../capacity-da/capacity.repository.js';
import { CapacityClService } from '../capacity-cl/capacity-cl.service.js';
import { ConsumerHealth } from '#core/providers/kafka/consumer-health.provider.js';
import { reservationDto } from '#helpers/reservation.helpers.js';
import {
  type Principal,
  MAX_ACTIVE,
  currencySchema,
  fail,
  formatMoney,
} from '#helpers/capacity.helpers.js';
import { ApiResult } from '#interfaces/api-result.js';
import type { ListQueryDto, ReservationListQueryDto } from '../../dto/list-query.dto.js';

@Injectable()
export class CapacityService {
  constructor(
    readonly repository: CapacityRepository,
    readonly health: ConsumerHealth,
    private readonly commands: CapacityClService,
  ) {}

  async access(
    principal: Principal,
    id: string,
    permission: string,
  ): Promise<Program & { _count: { reservations: number } }> {
    const p = await this.repository.find(principal.tenantId, id);

    if (!p) return fail(404, 'NOT_FOUND', 'Program not found');

    if (!principal.permissions.includes(permission))
      return fail(403, 'FORBIDDEN', 'Permission required');

    return p;
  }

  async capacity(principal: Principal, id: string) {
    const p = await this.access(principal, id, 'capacity:read');

    return this.capacityData(p);
  }

  private capacityData(p: Program & { _count: { reservations: number } }) {
    const currency = currencySchema.parse(p.currency);

    return {
      programId: p.id,
      currency,
      limit: formatMoney(p.limitMinor, currency),
      reserved: formatMoney(p.reservedMinor, currency),
      available: formatMoney(
        p.limitMinor > p.reservedMinor ? p.limitMinor - p.reservedMinor : 0n,
        currency,
      ),
      overLimit: formatMoney(
        p.reservedMinor > p.limitMinor ? p.reservedMinor - p.limitMinor : 0n,
        currency,
      ),
      stateVersion: p.stateVersion.toString(),
      syncStatus: p.syncStatus,
      acceptingReservations:
        this.health.connected &&
        p.syncStatus === 'READY' &&
        p.limitMinor > p.reservedMinor &&
        p._count.reservations < MAX_ACTIVE,
      lastAppliedTreasuryAt: p.lastTreasuryAt?.toISOString() ?? null,
    };
  }

  async programs(principal: Principal, query: ListQueryDto) {
    if (!principal.permissions.includes('capacity:read'))
      return fail(403, 'FORBIDDEN', 'Permission required');

    const result = await this.repository.programs(principal.tenantId, query);

    return new ApiResult(
      result.data.map((p) => ({
        ...this.capacityData(p),
        activeReservationCount: p._count.reservations,
      })),
      result.meta,
    );
  }

  async reservations(principal: Principal, id: string, query: ReservationListQueryDto) {
    const p = await this.access(principal, id, 'capacity:read');
    const result = await this.repository.reservations(principal.tenantId, id, query);

    return new ApiResult(
      result.data.map((r) => reservationDto(r, currencySchema.parse(p.currency))),
      result.meta,
    );
  }

  async movements(principal: Principal, id: string, query: ListQueryDto) {
    const p = await this.access(principal, id, 'capacity:read');
    const currency = currencySchema.parse(p.currency);
    const result = await this.repository.movements(principal.tenantId, id, query);
    const money = (value: bigint) =>
      value < 0n ? `-${formatMoney(-value, currency)}` : formatMoney(value, currency);

    return new ApiResult(
      result.data.map((r) => ({
        id: r.id,
        programId: r.programId,
        reservationId: r.reservationId,
        currency,
        reservedDelta: money(r.reservedDelta),
        limitDelta: money(r.limitDelta),
        reason: r.reason,
        stateVersion: r.stateVersion.toString(),
        createdAt: r.createdAt.toISOString(),
      })),
      result.meta,
    );
  }

  async reservation(principal: Principal, id: string, reservationId: string) {
    const p = await this.access(principal, id, 'capacity:read');
    const r = await this.repository.readReservation(principal.tenantId, id, reservationId);

    if (!r) return fail(404, 'NOT_FOUND', 'Reservation not found');

    return reservationDto(r, currencySchema.parse(p.currency));
  }

  reserve(...args: Parameters<CapacityClService['reserve']>) {
    return this.commands.reserve(...args);
  }

  release(...args: Parameters<CapacityClService['release']>) {
    return this.commands.release(...args);
  }

  view(...args: Parameters<CapacityClService['view']>) {
    return this.commands.view(...args);
  }
}
