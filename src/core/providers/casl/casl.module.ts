import { Module, type DynamicModule } from '@nestjs/common';
import { CASL_FEATURE_OPTIONS, CASL_ROOT_OPTIONS } from './casl.constants.js';
import { AccessGuard } from './access.guard.js';
import { AbilityFactory } from './ability.factory.js';
import type { Permissions } from './interfaces/access.interface.js';

@Module({})
export class CaslModule {
  static forRoot(options: { superuserRole?: string } = {}): DynamicModule {
    return { module: CaslModule, global: true, providers: [{ provide: CASL_ROOT_OPTIONS, useValue: options }], exports: [CASL_ROOT_OPTIONS] };
  }
  static forFeature(options: { permissions: Permissions }): DynamicModule {
    return { module: CaslModule, providers: [
      { provide: CASL_FEATURE_OPTIONS, useValue: options.permissions }, AbilityFactory, AccessGuard,
    ], exports: [AccessGuard, AbilityFactory] };
  }
}
