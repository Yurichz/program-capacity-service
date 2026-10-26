import {
  Injectable,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  type Type,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { map } from 'rxjs';
import { ApiResult } from '#interfaces/api-result.js';
import { SERIALIZE_ENTITY } from '#decorators/serialize.decorator.js';
import { SKIP_ENVELOPE } from '#decorators/skip-envelope.decorator.js';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const targets = [context.getHandler(), context.getClass()];
    const entity = this.reflector.getAllAndOverride<Type<unknown> | undefined>(
      SERIALIZE_ENTITY,
      targets,
    );
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE, targets);
    return next.handle().pipe(
      map((value: unknown) => {
        if (context.switchToHttp().getResponse().statusCode === 204) return undefined;
        if (skip || value instanceof StreamableFile) return value;
        const result = value instanceof ApiResult ? value : new ApiResult(value);
        const data = result.data ?? null;
        const serialized =
          entity && data !== null && typeof data === 'object'
            ? instanceToPlain(plainToInstance(entity, data, { excludeExtraneousValues: true }))
            : data;
        return { success: true, data: serialized, ...(result.meta ? { meta: result.meta } : {}) };
      }),
    );
  }
}
