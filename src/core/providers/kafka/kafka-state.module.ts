import { Module } from '@nestjs/common';
import { ConsumerHealth } from './consumer-health.provider.js';
@Module({ providers: [ConsumerHealth], exports: [ConsumerHealth] })
export class KafkaStateModule {}
