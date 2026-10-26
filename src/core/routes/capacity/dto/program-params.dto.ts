import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
export class ProgramParamsDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() programId!: string;
}
export class ReservationParamsDto extends ProgramParamsDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() reservationId!: string;
}
