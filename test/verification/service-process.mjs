import 'reflect-metadata';
import { database, prismaFor } from '../../dist/core/providers/prisma/create-database.js';
import { CapacityRepository } from '../../dist/core/routes/capacity/layers/capacity-da/capacity.repository.js';
import { CapacityClService } from '../../dist/core/routes/capacity/layers/capacity-cl/capacity-cl.service.js';
import { CapacityService } from '../../dist/core/routes/capacity/layers/capacity-bl/capacity.service.js';
import { TreasuryRepository } from '../../dist/core/routes/treasury/layers/treasury-da/treasury.repository.js';
import { TreasuryClService } from '../../dist/core/routes/treasury/layers/treasury-cl/treasury-cl.service.js';
import { ConsumerHealth } from '../../dist/core/providers/kafka/consumer-health.provider.js';
import { FxRateProvider } from '../../dist/core/providers/fx/fx-rate.provider.js';
import { FinancialTransactionService } from '../../dist/core/providers/prisma/financial-transaction.service.js';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { testDatabaseUrl } from '../../scripts/test-support.mjs';

export function services(db) {
  const prisma = prismaFor(db);
  const repository = new CapacityRepository(prisma);
  const health = new ConsumerHealth();
  health.connected = true;
  const transactions = new FinancialTransactionService(prisma);
  const cl = new CapacityClService(repository, health, new FxRateProvider(), transactions, prisma);
  const config = new ConfigService({ TREASURY_SOURCE: 'independent-audit' });

  return {
    capacity: new CapacityService(repository, health, cl),
    treasury: new TreasuryClService(repository, new TreasuryRepository(prisma, config), transactions, config),
  };
}

if (process.argv.includes('--child')) {
  Logger.overrideLogger(false);
  const db = database(testDatabaseUrl(process.env.TEST_DATABASE_URL));
  const { capacity } = services(db);
  process.on('message', async ({ id, method, args }) => {
    try {
      const value = await capacity[method](...args);
      process.send({ id, value });
    } catch (error) {
      process.send({ id, error: { message: error.message, code: error.code } });
    }
  });
  process.on('disconnect', async () => {
    await db.$disconnect();
    process.exit(0);
  });
  process.send({ ready: true });
}
