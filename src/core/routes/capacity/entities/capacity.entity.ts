import { Exclude, Expose } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
@Exclude()
export class CapacityEntity {
  /** Used by CASL resource hooks; excluded from public responses. */
  tenantId!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) programId!: string;
  @Expose() @ApiProperty() currency!: string;
  @Expose() @ApiProperty({ example: '10000000.00' }) limit!: string;
  @Expose() @ApiProperty({ example: '0.00' }) reserved!: string;
  @Expose() @ApiProperty({ example: '10000000.00' }) available!: string;
  @Expose() @ApiProperty({ example: '0.00' }) overLimit!: string;
  @Expose() @ApiProperty({ example: '1' }) stateVersion!: string;
  @Expose() @ApiProperty({ enum: ['READY', 'RECONCILIATION_REQUIRED'] }) syncStatus!: string;
  @Expose() @ApiProperty() acceptingReservations!: boolean;
  @Expose()
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  lastAppliedTreasuryAt!: string | null;
}
