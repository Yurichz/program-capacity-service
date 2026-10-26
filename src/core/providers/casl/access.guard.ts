import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException, type CanActivate, type ExecutionContext, type Type } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import { subject, type Subject } from '@casl/ability';
import { AbilityFactory } from './ability.factory.js';
import { ACCESS_ABILITY } from './casl.constants.js';
import type { AuthorizableRequest, SubjectHook } from './interfaces/access.interface.js';
import { Actions } from './actions.enum.js';

export interface AbilityMetadata { action: Actions; target: Subject; hook?: Type<SubjectHook>; }

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly factory: AbilityFactory, private readonly modules: ModuleRef) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthorizableRequest>();
    if (!request.user) throw new UnauthorizedException();
    const rule = this.reflector.getAllAndOverride<AbilityMetadata>(ACCESS_ABILITY, [context.getHandler(), context.getClass()]);
    if (!rule) throw new ForbiddenException();
    const ability = this.factory.createForUser(request.user);
    if (rule.hook) {
      const resource = await this.modules.get(rule.hook, { strict: false }).run(request);
      if (!resource) throw new NotFoundException();
      if (!ability.can(rule.action, rule.target)) throw new ForbiddenException();
      if (!ability.can(rule.action, subject(rule.target as string, resource))) throw new NotFoundException();
      return true;
    }
    // Conditions on a resource require its hook; checking the class alone cannot establish ownership.
    const relevant = ability.rulesFor(rule.action, rule.target as string);
    if (!ability.can(rule.action, rule.target) || relevant.some((item) => item.conditions)) throw new ForbiddenException();
    return true;
  }
}
