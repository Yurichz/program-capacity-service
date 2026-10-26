import { Module } from '@nestjs/common';
import { CaslModule } from '#core/providers/casl/casl.module.js';
import { CapacityDaModule } from '#core/routes/capacity/layers/capacity-da/capacity-da.module.js';
import { CapacityClModule } from '#core/routes/capacity/layers/capacity-cl/capacity-cl.module.js';
import { capacityPermissions } from '#core/routes/capacity/layers/capacity-bl/capacity.permissions.js';
import { CapacitySubjectHook } from '#core/routes/capacity/layers/capacity-bl/capacity.hook.js';
import { TreasuryDaModule } from '../treasury-da/treasury-da.module.js';
import { TreasuryClModule } from '../treasury-cl/treasury-cl.module.js';
import { TreasuryService } from './treasury.service.js';
import { TreasuryController } from './treasury.controller.js';
@Module({ imports: [TreasuryDaModule, TreasuryClModule, CapacityDaModule, CapacityClModule, CaslModule.forFeature({ permissions: capacityPermissions })],
  controllers: [TreasuryController], providers: [TreasuryService, CapacitySubjectHook], exports: [TreasuryService] })
export class TreasuryBlModule {}
