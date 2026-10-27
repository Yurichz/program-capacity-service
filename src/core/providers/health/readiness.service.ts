import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '#core/providers/prisma/prisma.service.js';
import { ConsumerHealth } from '#core/providers/kafka/consumer-health.provider.js';

@Injectable()
export class ReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consumer: ConsumerHealth,
  ) {}

  async check() {
    if (this.consumer.stopping || !this.consumer.connected) throw new ServiceUnavailableException();

    try {
      await this.prisma.$tx(
        async (client) => {
          await client.$executeRaw`SET LOCAL statement_timeout = '1s'`;
          await client.$queryRaw`SELECT 1`;
        },
        { maxWait: 1000, timeout: 2000 },
      );
    } catch {
      throw new ServiceUnavailableException();
    }

    if (this.consumer.stopping || !this.consumer.connected) throw new ServiceUnavailableException();

    return { status: 'ready' };
  }
}
