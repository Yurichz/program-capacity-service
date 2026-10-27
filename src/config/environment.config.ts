import { plainToInstance, Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Matches, Max, Min, MinLength, validateSync } from 'class-validator';

export class Environment {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @IsString()
  @Matches(/^postgres(?:ql)?:\/\//)
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  ACCESS_TOKEN_TTL_SECONDS = 900;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  REFRESH_TOKEN_TTL_SECONDS = 2592000;

  @IsString()
  @MinLength(1)
  JWT_ISSUER = 'capacity-dev';

  @IsString()
  @MinLength(1)
  JWT_AUDIENCE = 'capacity-service';

  @IsString()
  @Matches(/^[^\s,]+:\d+(,[^\s,]+:\d+)*$/)
  KAFKA_BROKERS = 'localhost:19092';

  @IsString()
  @MinLength(1)
  KAFKA_TOPIC = 'treasury.capacity.v1';

  @IsString()
  @MinLength(1)
  KAFKA_GROUP_ID = 'capacity-service-v1';

  @IsString()
  @MinLength(1)
  TREASURY_SOURCE = 'local-treasury';

  @IsIn(['debug', 'info', 'warn', 'error', 'silent'])
  LOG_LEVEL = 'info';
}

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const selected = Object.fromEntries(
    Object.keys(new Environment())
      .concat(['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'])
      .filter((key) => input[key] !== undefined)
      .map((key) => [key, input[key]]),
  );
  const value = plainToInstance(Environment, selected);
  const errors = validateSync(value, { validationError: { target: false, value: false } });
  if (errors.length)
    throw new Error(`Invalid environment: ${errors.map((error) => error.property).join(', ')}`);
  if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET)
    throw new Error('JWT secrets must differ');

  return value;
}
