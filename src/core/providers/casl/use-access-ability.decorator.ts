import { applyDecorators, SetMetadata, UseGuards, type Type } from '@nestjs/common';
import type { Subject } from '@casl/ability';
import { AccessGuard } from './access.guard.js';
import { ACCESS_ABILITY } from './casl.constants.js';
import { Actions } from './actions.enum.js';
import type { SubjectHook } from './interfaces/access.interface.js';

export function UseAccessAbility(action: Actions, target: Subject, hook?: Type<SubjectHook>) {
  return applyDecorators(
    SetMetadata(ACCESS_ABILITY, { action, target, hook }),
    UseGuards(AccessGuard),
  );
}
