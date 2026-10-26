import { Module } from '@nestjs/common';
import { CapacityRepository } from './capacity.repository.js';
@Module({ providers: [CapacityRepository], exports: [CapacityRepository] })
export class CapacityDaModule {}
