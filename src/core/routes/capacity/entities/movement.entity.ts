import { Exclude, Expose } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

@Exclude()
export class MovementEntity {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() programId!: string;
  @Expose() @ApiProperty({ type: String, nullable: true }) reservationId!: string | null;
  @Expose() @ApiProperty() currency!: string;
  @Expose() @ApiProperty() reservedDelta!: string;
  @Expose() @ApiProperty() limitDelta!: string;
  @Expose() @ApiProperty() reason!: string;
  @Expose() @ApiProperty() stateVersion!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
