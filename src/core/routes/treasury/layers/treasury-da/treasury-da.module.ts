import { Module } from '@nestjs/common';
import { TreasuryRepository } from './treasury.repository.js';
@Module({ providers: [TreasuryRepository], exports: [TreasuryRepository] })
export class TreasuryDaModule {}
