import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipAuth } from '#guards/skip-auth.guard.js';
import { CurrentUser } from '#decorators/current-user.decorator.js';
import { Serialize } from '#decorators/serialize.decorator.js';
import { ApiDefaultResponse } from '#decorators/api-default-response.decorator.js';
import type { AuthorizableUser } from '#core/providers/casl/interfaces/access.interface.js';
import { UserEntity } from '#core/routes/user/entities/user.entity.js';
import { SignUpDto } from '../../dto/sign-up.dto.js';
import { SignInDto } from '../../dto/sign-in.dto.js';
import { RefreshTokenDto } from '../../dto/refresh-token.dto.js';
import { JwtTokensEntity } from '../../entities/jwt-tokens.entity.js';
import { AuthService } from './auth.service.js';

@ApiTags('Auth') @Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}
  @Post('sign-up') @SkipAuth() @Serialize(UserEntity) @ApiDefaultResponse(UserEntity, { status: 201 })
  signUp(@Body() input: SignUpDto) { return this.service.signUp(input); }
  @Post('sign-in') @SkipAuth() @Serialize(JwtTokensEntity) @ApiDefaultResponse(JwtTokensEntity)
  signIn(@Body() input: SignInDto) { return this.service.signIn(input); }
  @Post('token/refresh') @SkipAuth() @Serialize(JwtTokensEntity) @ApiDefaultResponse(JwtTokensEntity)
  refresh(@Body() input: RefreshTokenDto) { return this.service.refresh(input.refreshToken); }
  @Post('logout') @ApiBearerAuth() @ApiDefaultResponse(undefined, { status: 204 })
  logout(@CurrentUser() user: AuthorizableUser) { return this.service.logout(user.id, user.sessionId); }
}
