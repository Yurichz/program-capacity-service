import { HttpException, type ValidationError } from '@nestjs/common';
import { ERRORS } from '#constants/errors.constants.js';

function flatten(errors: ValidationError[], parent = ''): Record<string, string[]> {
  return Object.assign(
    {},
    ...errors.map((error) => {
      const path = parent ? `${parent}.${error.property}` : error.property;

      return {
        ...(error.constraints ? { [path]: Object.values(error.constraints) } : {}),
        ...flatten(error.children ?? [], path),
      };
    }),
  );
}

export class ValidationException extends HttpException {
  constructor(errors: ValidationError[]) {
    super({ message: ERRORS.VALIDATION_ERROR, details: flatten(errors) }, 422);
  }
}
