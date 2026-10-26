import { Injectable } from '@nestjs/common';
import type { Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '#core/providers/prisma/prisma.service.js';
import { TxScopeRepository } from '#core/providers/prisma/tx-scope-repository.js';

@Injectable()
export class SessionRepository extends TxScopeRepository<Prisma.TransactionClient['session']> {
  constructor(prisma: PrismaService) { super(prisma, (client) => client.session); }
  createSession(input: { id: string; userId: number; refreshTokenHash: string; expiresAt: Date }) { return this.$.create({ data: input }); }
  findActive(id: string, userId: number) {
    return this.$.findFirst({ where: { id, userId, revokedAt: null, expiresAt: { gt: new Date() } }, select: {
      id: true, user: { select: { id: true, email: true, firstName: true, lastName: true, roles: true, tenantId: true, clientId: true } },
    } });
  }
  async rotate(id: string, userId: number, previousHash: string, nextHash: string, expiresAt: Date) {
    const result = await this.$.updateMany({
      where: { id, userId, refreshTokenHash: previousHash, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { refreshTokenHash: nextHash, expiresAt },
    });
    return result.count === 1;
  }
  revoke(id: string, userId: number) { return this.$.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } }); }
}
