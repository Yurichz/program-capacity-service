import { Exclude, Expose, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ReservationEntity } from '#core/routes/capacity/entities/reservation.entity.js';

@Exclude()
export class ReconciliationViewEntity {
  @Expose()
  @ApiProperty({ format: 'uuid' })
  programId!: string;

  @Expose()
  @ApiProperty()
  currency!: string;

  @Expose()
  @ApiProperty()
  limit!: string;

  @Expose()
  @ApiProperty()
  stateVersion!: string;

  @Expose()
  @ApiProperty()
  lastAppliedTreasuryRevision!: string;

  @Expose()
  @ApiProperty()
  highestSeenTreasuryRevision!: string;

  @Expose()
  @ApiProperty({ type: [ReservationEntity] })
  @Type(() => ReservationEntity)
  reservations!: ReservationEntity[];
}
