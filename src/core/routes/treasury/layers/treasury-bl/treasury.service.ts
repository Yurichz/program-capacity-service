import { Injectable } from '@nestjs/common';
import { TreasuryClService } from '../treasury-cl/treasury-cl.service.js';
import { CapacityClService } from '#core/routes/capacity/layers/capacity-cl/capacity-cl.service.js';
import { TreasuryRepository } from '../treasury-da/treasury.repository.js';
import type { TreasuryEventListQueryDto } from '#core/routes/capacity/dto/list-query.dto.js';
import { fail, type Principal } from '#helpers/capacity.helpers.js';
import { ApiResult } from '#interfaces/api-result.js';
@Injectable()
export class TreasuryService {
  constructor(private readonly coordinator: TreasuryClService, private readonly capacity: CapacityClService, private readonly repository: TreasuryRepository) {}
  async events(principal: Principal, programId: string, query: TreasuryEventListQueryDto) {
    if (!principal.permissions.includes('treasury:reconcile')) return fail(403, 'FORBIDDEN', 'Permission required');
    const result = await this.repository.events(principal.tenantId, programId, query);
    return new ApiResult(result.data.map(row => {
      const payload = row.payload as { type?: unknown } | null;
      const outcome = row.result as { code?: unknown } | null;
      return { id: row.id, eventId: row.eventId, programId: row.programId, treasuryRevision: row.revision.toString(),
        type: typeof payload?.type === 'string' ? payload.type : 'Unknown', resultCode: typeof outcome?.code === 'string' ? outcome.code : null,
        createdAt: row.createdAt.toISOString() };
    }), result.meta);
  }
  requireReconciliation() { return this.coordinator.requireReconciliation(); }
  process(...args: Parameters<TreasuryClService['process']>) { return this.coordinator.process(...args); }
  view(...args: Parameters<CapacityClService['view']>) { return this.capacity.view(...args); }
}
