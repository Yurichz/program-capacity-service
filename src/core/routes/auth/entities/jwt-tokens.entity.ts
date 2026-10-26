import { Exclude, Expose } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
@Exclude()
export class JwtTokensEntity {
  @Expose() @ApiProperty() accessToken!: string;
  @Expose() @ApiProperty() refreshToken!: string;
}
