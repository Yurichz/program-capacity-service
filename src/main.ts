import { ConfigService } from '@nestjs/config';
import { createApplication } from './core/app/create-application.js';
import { Logger } from 'nestjs-pino';
import { TreasuryConsumer } from '#core/providers/kafka/treasury-consumer.provider.js';
import { ConsumerHealth } from '#core/providers/kafka/consumer-health.provider.js';
import { databaseErrorContext } from '#helpers/database-error.helpers.js';

const app = await createApplication();
const consumer = app.get(TreasuryConsumer);
const health = app.get(ConsumerHealth);
const logger = app.get(Logger);
let shutdownTask: Promise<void> | undefined;
async function bounded(task: Promise<unknown>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Shutdown step timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function shutdown() {
  if (shutdownTask) return shutdownTask;
  health.stopping = true;
  health.connected = false;
  shutdownTask = (async () => {
    // Docker grants 40 seconds. Leave time for its init process to reap children.
    const deadline = setTimeout(() => {
      logger.error('Shutdown deadline exceeded');
      process.exit(1);
    }, 35000);
    deadline.unref();
    try {
      try {
        await bounded(consumer.stop(), 20000);
      } catch (error) {
        logger.error({ ...databaseErrorContext(error), operation: 'consumer.stop' });
        process.exitCode = 1;
      }
      try {
        await bounded(app.close(), 12000);
      } catch (error) {
        logger.error({ ...databaseErrorContext(error), operation: 'application.close' });
        process.exitCode = 1;
      }
    } finally {
      clearTimeout(deadline);
    }
    if (process.exitCode) process.exit(1);
  })();

  return shutdownTask;
}
process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
try {
  await app.init();
  if (!health.stopping) await consumer.start();
  if (!health.stopping)
    await app.listen(app.get(ConfigService).getOrThrow<number>('PORT'), '0.0.0.0');
} catch (error) {
  logger.error({ ...databaseErrorContext(error), operation: 'startup' });
  process.exitCode = 1;
  await shutdown();
}
