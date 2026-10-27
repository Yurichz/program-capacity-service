import { Module } from '@nestjs/common';
import { CapacityDaModule } from '../capacity-da/capacity-da.module.js';
import { KafkaStateModule } from '#core/providers/kafka/kafka-state.module.js';
import { FxModule } from '#core/providers/fx/fx.module.js';
import { CapacityClService } from './capacity-cl.service.js';

@Module({
  imports: [CapacityDaModule, KafkaStateModule, FxModule],
  providers: [CapacityClService],
  exports: [CapacityClService],
})
export class CapacityClModule {}
