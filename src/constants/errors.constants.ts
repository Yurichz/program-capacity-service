export const ERRORS = {
  BAD_REQUEST: '400000: Bad request',
  PRISMA_API_ERROR: '400005: Prisma API error',
  UNAUTHORIZED_RESOURCE: '401000: Unauthorized resource',
  INVALID_CREDENTIALS: '401001: Invalid credentials',
  FORBIDDEN_RESOURCE: '403000: Forbidden resource',
  NOT_FOUND: '404000: Not found',
  USER_NOT_FOUND: '404001: User not found',
  CONFLICT: '409000: Conflict',
  USER_CONFLICT: '409001: User with this email already exists',
  VALIDATION_ERROR: '422000: Validation error',
  RATE_LIMIT_EXCEEDED: '429000: Rate limit exceeded',
  INTERNAL_SERVER_ERROR: '500000: Internal server error',
} as const;
