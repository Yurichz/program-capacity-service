import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TokenService } from '#core/providers/token/token.service.js';
import { SessionRepository } from '#core/routes/auth/layers/auth-da/session.repository.js';
import type { AuthorizableRequest } from '#core/providers/casl/interfaces/access.interface.js';
import { SKIP_AUTH } from './skip-auth.guard.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tokens: TokenService, private readonly sessions: SessionRepository) {}

  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(SKIP_AUTH, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AuthorizableRequest>();
    request.user = await this.authenticate(request.headers.authorization);
    return true;
  }

  async authenticate(authorization?: string) {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? '');
    if (!match) throw new UnauthorizedException();
    const claims = await this.tokens.verify(match[1], 'access');
    const session = await this.sessions.findActive(claims.sid, Number(claims.sub));
    if (!session) throw new UnauthorizedException();
    return { ...session.user, sessionId: session.id };
  }
}
