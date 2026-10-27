import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '#decorators/current-user.decorator.js';
import { Serialize } from '#decorators/serialize.decorator.js';
import { ApiDefaultResponse } from '#decorators/api-default-response.decorator.js';
import { UseAccessAbility } from '#core/providers/casl/use-access-ability.decorator.js';
import { Actions } from '#core/providers/casl/actions.enum.js';
import type { AuthorizableUser } from '#core/providers/casl/interfaces/access.interface.js';
import { UserEntity } from '../../entities/user.entity.js';
import { UpdateUserDto } from '../../dto/update-user.dto.js';
import { UserSubjectHook } from './user.hook.js';
import { UserService } from './user.service.js';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UserController {
  constructor(private readonly service: UserService) {}

  @Get('me')
  @Serialize(UserEntity)
  @ApiDefaultResponse(UserEntity)
  @UseAccessAbility(Actions.read, UserEntity, UserSubjectHook)
  me(@CurrentUser() user: AuthorizableUser) {
    return this.service.me(user.id);
  }

  @Patch('me')
  @Serialize(UserEntity)
  @ApiDefaultResponse(UserEntity)
  @UseAccessAbility(Actions.update, UserEntity, UserSubjectHook)
  update(@CurrentUser() user: AuthorizableUser, @Body() input: UpdateUserDto) {
    return this.service.updateMe(user.id, input);
  }
}
