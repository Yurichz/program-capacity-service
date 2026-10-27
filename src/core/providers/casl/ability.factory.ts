import { Inject, Injectable } from '@nestjs/common';
import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import { CASL_FEATURE_OPTIONS, CASL_ROOT_OPTIONS } from './casl.constants.js';
import { Actions } from './actions.enum.js';
import type { AppAbility, AuthorizableUser, Permissions } from './interfaces/access.interface.js';

@Injectable()
export class AbilityFactory {
  constructor(
    @Inject(CASL_FEATURE_OPTIONS) private readonly permissions: Permissions,
    @Inject(CASL_ROOT_OPTIONS) private readonly options: { superuserRole?: string },
  ) {}

  createForUser(user: AuthorizableUser): AppAbility {
    const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
    const context = { user, can: builder.can.bind(builder), cannot: builder.cannot.bind(builder) };
    this.permissions.everyone?.(context);
    for (const role of user.roles) this.permissions[role]?.(context);
    if (this.options.superuserRole && user.roles.includes(this.options.superuserRole))
      builder.can(Actions.manage, 'all');

    return builder.build({
      detectSubjectType: (resource) =>
        Reflect.get(resource, '__caslSubjectType__') ?? resource.constructor,
    });
  }
}
