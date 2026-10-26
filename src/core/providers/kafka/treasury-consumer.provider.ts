import { Kafka, logLevel, type Consumer, type EachBatchPayload } from 'kafkajs';
import type { Logger } from 'pino';
import type { Environment as Config } from '#config/environment.config.js';
import { ConsumerHealth } from './consumer-health.provider.js';
import { TreasuryService } from '#core/routes/treasury/layers/treasury-bl/treasury.service.js';

export class TreasuryConsumer {
  readonly consumer: Consumer;
  private stopping = false;
  private lastHeartbeat = 0;
  private watchdog?: ReturnType<typeof setInterval>;
  private invalidating: Promise<void> = Promise.resolve();
  constructor(readonly config: Config, readonly treasury: TreasuryService, readonly health: ConsumerHealth, readonly logger: Logger) {
    this.consumer = new Kafka({ clientId: 'capacity-service', brokers: config.KAFKA_BROKERS.split(','), logLevel: logLevel.ERROR,
      logCreator: () => ({ namespace, log }) => this.logger.error({ component: 'kafka', namespace }, String(log.message)),
      retry: { retries: 5, initialRetryTime: 300 } }).consumer({ groupId: config.KAFKA_GROUP_ID, allowAutoTopicCreation: false,
      maxBytesPerPartition: 3 * 1024 * 1024, maxBytes: 6 * 1024 * 1024, sessionTimeout: 30000, heartbeatInterval: 2000 });
    const connected = () => {
      this.lastHeartbeat = Date.now();
      void this.invalidating.then(() => { if (!this.stopping) this.health.connected = true; }).catch(() => { if (!this.stopping) void this.invalidate(); });
    };
    this.consumer.on(this.consumer.events.GROUP_JOIN, connected);
    this.consumer.on(this.consumer.events.HEARTBEAT, connected);
    this.consumer.on(this.consumer.events.CRASH, () => { void this.invalidate(); });
    this.consumer.on(this.consumer.events.DISCONNECT, () => { if (!this.stopping) void this.invalidate(); });
    this.consumer.on(this.consumer.events.REBALANCING, () => { void this.invalidate(); });
  }
  private async invalidate() {
    this.health.connected = false;
    this.invalidating = this.invalidating.catch(() => undefined).then(() => this.treasury.requireReconciliation());
    await this.invalidating.catch(error => this.logger.error({ err: error }, 'Could not persist consumer unavailability'));
  }
  async start(): Promise<void> {
    await this.treasury.requireReconciliation();
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.config.KAFKA_TOPIC, fromBeginning: true });
    await this.consumer.run({ autoCommit: false, eachBatchAutoResolve: false, partitionsConsumedConcurrently: 3,
      eachBatch: payload => this.batch(payload) });
    // Exceed the 10-second transaction ceiling so a bounded snapshot is not
    // mistaken for a disconnected consumer between explicit heartbeats.
    this.watchdog = setInterval(() => { if (this.health.connected && Date.now() - this.lastHeartbeat > 15000) void this.invalidate(); }, 1000);
    this.watchdog.unref();
  }
  async batch({ batch, heartbeat, isRunning, isStale, resolveOffset }: EachBatchPayload): Promise<void> {
    await this.invalidating;
    for (const message of batch.messages) {
      if (!isRunning() || isStale() || this.stopping) return;
      try {
        await heartbeat();
        const result = await this.treasury.process(message.value ?? Buffer.alloc(0), message.key?.toString() ?? null,
          { topic: batch.topic, partition: batch.partition, offset: message.offset });
        if (!isRunning() || isStale()) return;
        await heartbeat();
        await this.consumer.commitOffsets([{ topic: batch.topic, partition: batch.partition, offset: (BigInt(message.offset) + 1n).toString() }]);
        resolveOffset(message.offset);
        this.logger.info({ topic: batch.topic, partition: batch.partition, offset: message.offset, ...result }, 'Treasury message persisted');
      } catch (error) {
        await this.invalidate();
        throw error;
      }
    }
  }
  async stop() {
    this.stopping = true; this.health.connected = false;
    if (this.watchdog) clearInterval(this.watchdog);
    await this.consumer.stop();
    await this.consumer.disconnect();
    await this.invalidating.catch(() => undefined);
  }
}
