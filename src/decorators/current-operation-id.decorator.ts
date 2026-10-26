import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
export const CurrentOperationId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<{ id?: string | number }>();
    return String(request.id ?? randomUUID());
  },
);
