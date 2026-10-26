import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthorizableRequest } from '#core/providers/casl/interfaces/access.interface.js';
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext) =>
  context.switchToHttp().getRequest<AuthorizableRequest>().user);
