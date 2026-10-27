import { Module } from '@nestjs/common';
import { SessionRepository } from './session.repository.js';

@Module({ providers: [SessionRepository], exports: [SessionRepository] })
export class AuthDaModule {}
