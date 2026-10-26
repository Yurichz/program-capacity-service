import { Module } from '@nestjs/common';
import { TokenModule } from '#core/providers/token/token.module.js';
import { UserDaModule } from '#core/routes/user/layers/user-da/user-da.module.js';
import { AuthDaModule } from '../auth-da/auth-da.module.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
@Module({ imports: [UserDaModule, AuthDaModule, TokenModule], controllers: [AuthController], providers: [AuthService], exports: [AuthService] })
export class AuthBlModule {}
