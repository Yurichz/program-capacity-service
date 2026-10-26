import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { ValidationException } from '#filters/validation.exception.js';
import type {
  AuthorizableRequest,
  SubjectHook,
} from '#core/providers/casl/interfaces/access.interface.js';
import { CapacityRepository } from '../capacity-da/capacity.repository.js';

@Injectable()
export class ProgramListHook implements SubjectHook {
  async run(request: AuthorizableRequest) {
    return request.user ? { tenantId: request.user.tenantId } : undefined;
  }
}

@Injectable()
export class CapacitySubjectHook implements SubjectHook {
  constructor(private readonly capacity: CapacityRepository) {}
  async run(request: AuthorizableRequest) {
    if (!request.user) return undefined;
    const programId = request.params.programId;
    const reservationId = request.params.reservationId;
    if (
      typeof programId !== 'string' ||
      !isUUID(programId) ||
      (reservationId !== undefined && (typeof reservationId !== 'string' || !isUUID(reservationId)))
    )
      throw new ValidationException([
        { property: 'params', constraints: { uuid: 'Resource identifiers must be UUIDs' } },
      ]);
    const program = await this.capacity.find(request.user.tenantId, programId);
    if (!program) return undefined;
    if (
      typeof reservationId === 'string' &&
      !(await this.capacity.readReservation(request.user.tenantId, programId, reservationId))
    )
      return undefined;
    return { id: program.id, tenantId: program.tenantId };
  }
}
