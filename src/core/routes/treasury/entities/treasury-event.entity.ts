import { Exclude, Expose } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

@Exclude()
export class TreasuryEventEntity {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() eventId!: string;
  @Expose() @ApiProperty() programId!: string;
  @Expose() @ApiProperty() type!: string;
  @Expose() @ApiProperty() treasuryRevision!: string;
  @Expose() @ApiProperty({ type: String, nullable: true }) resultCode!: string | null;
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
