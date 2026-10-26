import { Transform } from 'class-transformer';
import { IsByteLength, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class SignUpDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @ApiProperty({ minLength: 8, writeOnly: true })
  @IsString()
  @MinLength(8)
  @IsByteLength(0, 72)
  password!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(256) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(256) lastName?: string;
}
