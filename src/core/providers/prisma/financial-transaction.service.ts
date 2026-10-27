import { Injectable } from '@nestjs/common';
import type { Prisma } from '#generated/prisma/client.js';
import { PrismaService } from './prisma.service.js';
import { databaseErrorContext } from '#helpers/database-error.helpers.js';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class FinancialTransactionService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(fn: (client: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$tx(
          async (client) => {
            await client.$executeRaw`SET LOCAL lock_timeout = '2s'`;
            await client.$executeRaw`SET LOCAL statement_timeout = '8s'`;
            await client.$executeRaw`SET LOCAL transaction_timeout = '10s'`;

            return fn(client);
          },
          { isolationLevel: 'ReadCommitted', maxWait: 2000, timeout: 10000 },
        );
      } catch (error) {
        const context = databaseErrorContext(error);
        const retryable =
          context.prismaCode === 'P2034' || ['40P01', '40001'].includes(context.sqlState ?? '');

        if (!retryable || attempt >= 2) throw error;
      }
    }
  }
}
