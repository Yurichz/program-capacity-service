import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TokenService } from './token.service.js';
import { PasswordService } from './password.service.js';

@Module({ imports: [JwtModule.register({})], providers: [TokenService, PasswordService], exports: [TokenService, PasswordService] })
export class TokenModule {}
