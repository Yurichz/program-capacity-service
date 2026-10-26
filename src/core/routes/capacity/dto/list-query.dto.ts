import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage = 10;
}
export class ReservationListQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'RELEASED', 'RECONCILED_CLOSED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'RELEASED', 'RECONCILED_CLOSED'])
  status?: 'ACTIVE' | 'RELEASED' | 'RECONCILED_CLOSED';
  @ApiPropertyOptional({ enum: ['USD', 'EUR', 'GBP', 'JPY', 'KWD'] })
  @IsOptional()
  @IsIn(['USD', 'EUR', 'GBP', 'JPY', 'KWD'])
  currency?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  invoiceId?: string;
}
export class TreasuryEventListQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  eventId?: string;
}
