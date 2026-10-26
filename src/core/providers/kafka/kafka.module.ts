import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { pino } from 'pino';
import { TreasuryBlModule } from '#core/routes/treasury/layers/treasury-bl/treasury-bl.module.js';
import { TreasuryService } from '#core/routes/treasury/layers/treasury-bl/treasury.service.js';
import { ConsumerHealth } from './consumer-health.provider.js';
import { KafkaStateModule } from './kafka-state.module.js';
import { TreasuryConsumer } from './treasury-consumer.provider.js';
import type { Environment } from '#config/environment.config.js';
@Module({ imports: [TreasuryBlModule, KafkaStateModule], providers: [{ provide: TreasuryConsumer,
  inject: [ConfigService, TreasuryService, ConsumerHealth],
  useFactory: (config: ConfigService, treasury: TreasuryService, health: ConsumerHealth) => new TreasuryConsumer({
    KAFKA_BROKERS: config.getOrThrow('KAFKA_BROKERS'), KAFKA_GROUP_ID: config.getOrThrow('KAFKA_GROUP_ID'), KAFKA_TOPIC: config.getOrThrow('KAFKA_TOPIC'),
  } as Environment, treasury, health, pino({ level: config.getOrThrow('LOG_LEVEL') })) }], exports: [TreasuryConsumer] })
export class KafkaModule {}
