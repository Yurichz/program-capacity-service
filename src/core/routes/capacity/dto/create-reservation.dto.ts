import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import { IsInvoiceAmount } from '#helpers/money-validation.helpers.js';
export class CreateReservationDto {
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @Matches(/^[A-Za-z0-9_.:-]{1,128}$/)
  invoiceId!: string;
  @ApiProperty({ type: String, example: '1250.50' })
  @IsString()
  @MaxLength(24)
  @Matches(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/)
  @IsInvoiceAmount()
  amount!: string;
  @ApiProperty({ enum: ['USD', 'EUR', 'GBP', 'JPY', 'KWD'] })
  @IsIn(['USD', 'EUR', 'GBP', 'JPY', 'KWD'])
  currency!: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'KWD';
}
