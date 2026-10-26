import { ConfigService } from '@nestjs/config';
import { createApplication } from './core/app/create-application.js';
import { PrismaService } from '#core/providers/prisma/prisma.service.js';
import { TreasuryConsumer } from '#core/providers/kafka/treasury-consumer.provider.js';
import { ConsumerHealth } from '#core/providers/kafka/consumer-health.provider.js';

const app = await createApplication();
const prisma = app.get(PrismaService);
const consumer = app.get(TreasuryConsumer);
const health = app.get(ConsumerHealth);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true; health.connected = false;
  await consumer.stop();
  await app.close();
}
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
try {
  await prisma.root.$connect();
  await consumer.start();
  await app.listen(app.get(ConfigService).getOrThrow<number>('PORT'), '0.0.0.0');
} catch (error) { console.error(error instanceof Error ? error.message : 'Startup failed'); await shutdown(); process.exitCode = 1; }
