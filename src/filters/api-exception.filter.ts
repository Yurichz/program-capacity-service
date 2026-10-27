import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';
import { ERRORS } from '#constants/errors.constants.js';
import { AppError } from '#helpers/capacity.helpers.js';
import { databaseErrorContext, isTransientDatabaseError } from '#helpers/database-error.helpers.js';

const defaults: Record<number, string> = {
  400: ERRORS.BAD_REQUEST,
  401: ERRORS.UNAUTHORIZED_RESOURCE,
  403: ERRORS.FORBIDDEN_RESOURCE,
  404: ERRORS.NOT_FOUND,
  409: ERRORS.CONFLICT,
  422: ERRORS.VALIDATION_ERROR,
  429: ERRORS.RATE_LIMIT_EXCEEDED,
  500: ERRORS.INTERNAL_SERVER_ERROR,
  503: '503000: Service temporarily unavailable',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    let status = exception instanceof HttpException ? exception.getStatus() : 500;
    let message = defaults[status] ?? `${status}000: Request failed`;
    let details: unknown;

    if (exception instanceof HttpException) {
      const response = exception.getResponse();

      if (typeof response === 'string') message = response;
      else {
        const body = response as { message?: unknown; details?: unknown };

        if (typeof body.message === 'string') message = body.message;

        if (Array.isArray(body.message)) details = body.message;

        if (body.details !== undefined) details = body.details;
      }
    } else if (isTransientDatabaseError(exception)) {
      status = 503;
      message = defaults[503];
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      status =
        (
          {
            P2000: 400,
            P2002: 409,
            P2003: 409,
            P2025: 404,
            P1001: 503,
            P1002: 503,
            P1008: 503,
            P1017: 503,
            P2024: 503,
            P2028: 503,
            P2034: 503,
          } as Record<string, number>
        )[exception.code] ?? 500;
      message = status >= 500 ? defaults[status] : ERRORS.PRISMA_API_ERROR;
      if (status < 500) details = exception.code;
    }

    if (status >= 500 && !(exception instanceof AppError)) {
      const request = host.switchToHttp().getRequest<{ id?: string; method?: string }>();

      this.logger.error({
        ...databaseErrorContext(exception),
        requestId: request.id,
        operation: request.method,
        outcome: 'error',
      });
      message = defaults[status] ?? ERRORS.INTERNAL_SERVER_ERROR;
      details = undefined;
    }

    const match = /^(\d+):\s*(.*)$/.exec(message);
    const code = match
      ? Number(match[1])
      : Number((defaults[status] ?? `${status}000`).split(':')[0]);

    return host
      .switchToHttp()
      .getResponse()
      .status(status)
      .json({
        success: false,
        error: {
          code,
          message: match ? match[2] : message,
          ...(details !== undefined ? { details } : {}),
        },
      });
  }
}
