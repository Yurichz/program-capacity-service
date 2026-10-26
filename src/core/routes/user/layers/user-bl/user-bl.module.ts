import { Module } from '@nestjs/common';
import { CaslModule } from '#core/providers/casl/casl.module.js';
import { UserDaModule } from '../user-da/user-da.module.js';
import { userPermissions } from './user.permissions.js';
import { UserSubjectHook } from './user.hook.js';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';
@Module({ imports: [UserDaModule, CaslModule.forFeature({ permissions: userPermissions })], controllers: [UserController], providers: [UserService, UserSubjectHook], exports: [UserService] })
export class UserBlModule {}
