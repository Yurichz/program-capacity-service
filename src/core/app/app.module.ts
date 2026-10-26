import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { validateEnvironment } from '#config/environment.config.js';
import { PrismaModule } from '#core/providers/prisma/prisma.module.js';
import { CaslModule } from '#core/providers/casl/casl.module.js';
import { TokenModule } from '#core/providers/token/token.module.js';
import { AuthGuard } from '#guards/auth.guard.js';
import { ResponseInterceptor } from '#interceptors/response.interceptor.js';
import { ApiExceptionFilter } from '#filters/api-exception.filter.js';
import { AppBLImports } from './app-bl-imports.js';
import { AppDaImports } from './app-da-imports.js';
import { AppCLImports } from './app-cl-imports.js';
import { AppController } from './app.controller.js';
import { KafkaModule } from '#core/providers/kafka/kafka.module.js';
import { KafkaStateModule } from '#core/providers/kafka/kafka-state.module.js';
import { ReadinessService } from '#core/providers/health/readiness.service.js';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.dev/runtime.env'],
      validate: validateEnvironment,
    }),
    PrismaModule.forRoot(),
    CaslModule.forRoot({ superuserRole: 'APP_ADMIN' }),
    TokenModule,
    KafkaModule,
    KafkaStateModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: (_request, response) => {
          const id = randomUUID();
          response.setHeader('X-Request-Id', id);
          return id;
        },
        customProps: (request) => {
          const ids =
            /^\/api\/v1\/(?:internal\/)?programs\/([0-9a-f-]{36})(?:\/reservations\/([0-9a-f-]{36}))?/.exec(
              request.url ?? '',
            );
          const correlation = request.headers['x-correlation-id'];
          return {
            requestId: request.id,
            operationId: request.id,
            operation: request.method,
            correlationId:
              typeof correlation === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(correlation)
                ? correlation
                : undefined,
            programId: ids?.[1],
            reservationId: ids?.[2],
          };
        },
        customSuccessObject: (_request, response, value) => ({
          ...value,
          outcome: response.statusCode < 400 ? 'success' : 'rejected',
        }),
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        serializers: {
          req: (request: { id: string; method: string; url: string }) => ({
            id: request.id,
            method: request.method,
            url: request.url.split('?')[0],
          }),
        },
      },
    }),
    ...AppDaImports,
    ...AppCLImports,
    ...AppBLImports,
  ],
  controllers: [AppController],
  providers: [
    ReadinessService,
    { provide: APP_GUARD, useClass: AuthGuard },
    AuthGuard,
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
