import { applyDecorators, HttpCode, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

export function ApiDefaultResponse(
  entity?: Type<unknown>,
  options: { status?: number; array?: boolean; paginated?: boolean } = {},
) {
  const status = options.status ?? 200;
  if (status === 204)
    return applyDecorators(HttpCode(204), ApiResponse({ status: 204, description: 'No content' }));
  const item: { $ref: string } | Record<string, never> = entity
    ? { $ref: getSchemaPath(entity) }
    : {};

  return applyDecorators(
    ...(entity ? [ApiExtraModels(entity)] : []),
    HttpCode(status),
    ApiResponse({
      status,
      schema: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data: options.array ? { type: 'array', items: item } : item,
          ...(options.paginated
            ? {
              meta: {
                type: 'object',
                properties: {
                  total: { type: 'integer' },
                  lastPage: { type: 'integer' },
                  currentPage: { type: 'integer' },
                  perPage: { type: 'integer' },
                  prev: { type: 'integer', nullable: true },
                  next: { type: 'integer', nullable: true },
                },
              },
            }
            : {}),
        },
      },
    }),
    ...[400, 401, 403, 404, 409, 422, 500, 503].map((code) =>
      ApiResponse({
        status: code,
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: { code: { type: 'integer' }, message: { type: 'string' }, details: {} },
            },
          },
        },
      }),
    ),
  );
}
