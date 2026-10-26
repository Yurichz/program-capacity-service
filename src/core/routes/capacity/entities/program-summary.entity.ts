import { Expose } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CapacityEntity } from './capacity.entity.js';

export class ProgramSummaryEntity extends CapacityEntity {
  @Expose() @ApiProperty() activeReservationCount!: number;
}
