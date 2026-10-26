import { Exclude, Expose } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

@Exclude()
export class UserEntity {
  @Expose() @ApiProperty() id!: number;
  @Expose() @ApiProperty() email!: string;
  @Expose() @ApiProperty({ type: String, nullable: true }) firstName!: string | null;
  @Expose() @ApiProperty({ type: String, nullable: true }) lastName!: string | null;
  @Expose() @ApiProperty({ type: [String] }) roles!: string[];
}
