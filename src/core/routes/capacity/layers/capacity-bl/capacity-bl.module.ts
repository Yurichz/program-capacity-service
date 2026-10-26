import { Module } from '@nestjs/common';
import { CaslModule } from '#core/providers/casl/casl.module.js';
import { KafkaStateModule } from '#core/providers/kafka/kafka-state.module.js';
import { CapacityDaModule } from '../capacity-da/capacity-da.module.js';
import { CapacityClModule } from '../capacity-cl/capacity-cl.module.js';
import { CapacityController, ProgramsController } from './capacity.controller.js';
import { CapacityService } from './capacity.service.js';
import { CapacitySubjectHook, ProgramListHook } from './capacity.hook.js';
import { capacityPermissions } from './capacity.permissions.js';
@Module({
  imports: [
    CapacityDaModule,
    CapacityClModule,
    KafkaStateModule,
    CaslModule.forFeature({ permissions: capacityPermissions }),
  ],
  controllers: [ProgramsController, CapacityController],
  providers: [CapacityService, CapacitySubjectHook, ProgramListHook],
  exports: [CapacityService],
})
export class CapacityBlModule {}
