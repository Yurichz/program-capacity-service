import { PrismaService } from './prisma.service.js';
import type { Prisma } from '#generated/prisma/client.js';
import { paginate } from '#helpers/paginate.js';

/** An explicit client belongs to the returned view, never to the singleton repository. */
export abstract class TxScopeRepository<T> {
  protected constructor(
    protected readonly prisma: PrismaService,
    private readonly model: (client: Prisma.TransactionClient) => T,
    private readonly explicitClient?: Prisma.TransactionClient,
  ) {}

  get $(): T {
    return this.model(this.explicitClient ?? this.prisma.client);
  }

  protected get client(): Prisma.TransactionClient {
    return this.explicitClient ?? this.prisma.client;
  }

  readonly paginate = paginate;

  tx(client?: Prisma.TransactionClient): this {
    const cache = new Map<PropertyKey, unknown>();
    const proxy: this = new Proxy(this, {
      get(object, key, receiver) {
        if (key === '$')
          return object.model(client ?? object.explicitClient ?? object.prisma.client);
        if (key === 'explicitClient') return client ?? object.explicitClient;
        const value = Reflect.get(object, key, receiver);
        if (typeof value !== 'function') return value;
        if (!cache.has(key)) cache.set(key, value.bind(proxy));

        return cache.get(key);
      },
    });

    return proxy;
  }
}
