import { Module, type DynamicModule } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { FinancialTransactionService } from './financial-transaction.service.js';

@Module({ providers: [PrismaService, FinancialTransactionService], exports: [PrismaService, FinancialTransactionService] })
export class PrismaModule {
  static forRoot(options: { isGlobal?: boolean } = {}): DynamicModule {
    return { module: PrismaModule, global: options.isGlobal ?? true };
  }
}
