import { Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '#generated/prisma/client.js';

type TxOptions = { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel };
export const PRISMA_CLIENT_OVERRIDE = Symbol('prisma-client-override');

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly root: PrismaClient;
  private readonly storage = new AsyncLocalStorage<Prisma.TransactionClient>();

  constructor(config: ConfigService, @Optional() @Inject(PRISMA_CLIENT_OVERRIDE) client?: PrismaClient) {
    this.root = client ?? new PrismaClient({ adapter: new PrismaPg({
      connectionString: config.getOrThrow<string>('DATABASE_URL'), connectionTimeoutMillis: 2000, max: 12,
    }) });
  }

  get client(): Prisma.TransactionClient { return this.storage.getStore() ?? this.root; }
  get currentTransaction(): Prisma.TransactionClient | undefined { return this.storage.getStore(); }

  async $tx<T>(fn: (client: Prisma.TransactionClient) => Promise<T>, options?: TxOptions): Promise<T> {
    if (this.currentTransaction) throw new Error('Nested $tx is not supported; use $txe to reuse the active transaction');
    return this.root.$transaction((client) => this.storage.run(client, () => fn(client)), options);
  }

  $txe<T>(fn: (client: Prisma.TransactionClient) => Promise<T>, client?: Prisma.TransactionClient, options?: TxOptions): Promise<T> {
    const active = client ?? this.currentTransaction;
    return active ? this.storage.run(active, () => fn(active)) : this.$tx(fn, options);
  }

  async onModuleDestroy() { await this.root.$disconnect(); }
}
