import { Module } from '@nestjs/common';
import { CapacityDaModule } from '#core/routes/capacity/layers/capacity-da/capacity-da.module.js';
import { TreasuryDaModule } from '../treasury-da/treasury-da.module.js';
import { TreasuryClService } from './treasury-cl.service.js';

@Module({
  imports: [CapacityDaModule, TreasuryDaModule],
  providers: [TreasuryClService],
  exports: [TreasuryClService],
})
export class TreasuryClModule {}
