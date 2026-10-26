import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';

interface TokenClaims { sub: string; sid: string; type: 'access' | 'refresh'; exp: number; jti: string; }

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService) {}

  async issue(userId: number, sessionId: string) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync({ sub: String(userId), sid: sessionId, type: 'access', jti: randomUUID() }, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'), algorithm: 'HS256', expiresIn: this.config.getOrThrow<number>('ACCESS_TOKEN_TTL_SECONDS'),
        issuer: this.config.getOrThrow<string>('JWT_ISSUER'), audience: this.config.getOrThrow<string>('JWT_AUDIENCE'),
      }),
      this.jwt.signAsync({ sub: String(userId), sid: sessionId, type: 'refresh', jti: randomUUID() }, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'), algorithm: 'HS256', expiresIn: this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_SECONDS'),
        issuer: this.config.getOrThrow<string>('JWT_ISSUER'), audience: this.config.getOrThrow<string>('JWT_AUDIENCE'),
      }),
    ]);
    return { accessToken, refreshToken };
  }

  async verify(token: string, type: 'access' | 'refresh'): Promise<TokenClaims> {
    try {
      const claims = await this.jwt.verifyAsync<TokenClaims>(token, {
        secret: this.config.getOrThrow<string>(type === 'access' ? 'JWT_ACCESS_SECRET' : 'JWT_REFRESH_SECRET'), algorithms: ['HS256'],
        issuer: this.config.getOrThrow<string>('JWT_ISSUER'), audience: this.config.getOrThrow<string>('JWT_AUDIENCE'),
      });
      if (claims.type !== type || typeof claims.sub !== 'string' || !/^[1-9]\d*$/.test(claims.sub) || !Number.isSafeInteger(Number(claims.sub)) || typeof claims.sid !== 'string' || !claims.sid || !Number.isInteger(claims.exp) || typeof claims.jti !== 'string' || !claims.jti) throw new Error('Invalid claims');
      return claims;
    } catch { throw new UnauthorizedException(); }
  }

  hashRefresh(token: string) { return createHash('sha256').update(token).digest('hex'); }
  refreshExpiresAt() { return new Date(Date.now() + this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_SECONDS') * 1000); }
}
