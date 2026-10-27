import { Module } from '@nestjs/common';
import { FxRateProvider } from './fx-rate.provider.js';

@Module({ providers: [FxRateProvider], exports: [FxRateProvider] })
export class FxModule {}
