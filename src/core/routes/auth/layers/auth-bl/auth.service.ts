import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UserRepository } from '#core/routes/user/layers/user-da/user.repository.js';
import { PasswordService } from '#core/providers/token/password.service.js';
import { TokenService } from '#core/providers/token/token.service.js';
import { ERRORS } from '#constants/errors.constants.js';
import { SessionRepository } from '../auth-da/session.repository.js';
import type { SignUpDto } from '../../dto/sign-up.dto.js';
import type { SignInDto } from '../../dto/sign-in.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}
  async signUp(input: SignUpDto) {
    return this.users.createAccount({
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      passwordHash: await this.passwords.hash(input.password),
    });
  }
  async signIn(input: SignInDto) {
    const user = await this.users.findCredentials(input.email);
    if (!user || !(await this.passwords.compare(input.password, user.passwordHash)))
      throw new UnauthorizedException(ERRORS.INVALID_CREDENTIALS);
    const id = randomUUID();
    const pair = await this.tokens.issue(user.id, id);
    await this.sessions.createSession({
      id,
      userId: user.id,
      refreshTokenHash: this.tokens.hashRefresh(pair.refreshToken),
      expiresAt: this.tokens.refreshExpiresAt(),
    });
    return pair;
  }
  async refresh(refreshToken: string) {
    const claims = await this.tokens.verify(refreshToken, 'refresh');
    const pair = await this.tokens.issue(Number(claims.sub), claims.sid);
    const rotated = await this.sessions.rotate(
      claims.sid,
      Number(claims.sub),
      this.tokens.hashRefresh(refreshToken),
      this.tokens.hashRefresh(pair.refreshToken),
      this.tokens.refreshExpiresAt(),
    );
    if (!rotated) throw new UnauthorizedException();
    return pair;
  }
  async logout(userId: number, sessionId: string) {
    await this.sessions.revoke(sessionId, userId);
  }
}
