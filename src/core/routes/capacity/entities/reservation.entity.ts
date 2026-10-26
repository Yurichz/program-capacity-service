import { Exclude, Expose, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
@Exclude()
export class FxEntity {
  @Expose() @ApiProperty() rate!: string;
  @Expose() @ApiProperty() direction!: string;
  @Expose() @ApiProperty() source!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) asOf!: string;
}
@Exclude()
export class ReservationEntity {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) programId!: string;
  @Expose() @ApiProperty() invoiceId!: string;
  @Expose() @ApiProperty({ example: '1250.50' }) amount!: string;
  @Expose() @ApiProperty() currency!: string;
  @Expose() @ApiProperty({ example: '1375.55' }) reservedAmount!: string;
  @Expose() @ApiProperty() programCurrency!: string;
  @Expose() @ApiProperty({ type: FxEntity }) @Type(() => FxEntity) fx!: FxEntity;
  @Expose() @ApiProperty({ enum: ['ACTIVE', 'RELEASED', 'RECONCILED_CLOSED'] }) status!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @Expose() @ApiProperty({ type: String, nullable: true, format: 'date-time' }) closedAt!:
    string | null;
}
