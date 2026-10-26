import 'reflect-metadata';
import { UnauthorizedException, ValidationPipe, VersioningType, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationException } from '#filters/validation.exception.js';
import { COMMON_CONSTANTS } from '#constants/common.constants.js';
import { AppModule } from './app.module.js';
import { AuthGuard } from '#guards/auth.guard.js';
import type { Request, Response, NextFunction } from 'express';
import { Logger } from 'nestjs-pino';

export async function createApplication(rootModule: Type<unknown> = AppModule) {
  const app = await NestFactory.create<NestExpressApplication>(rootModule, {
    logger: ['error', 'warn', 'log'],
  });
  return configureApplication(app);
}

/** Shared by production and real-HTTP tests; no authentication bypass. */
export function configureApplication(app: NestExpressApplication) {
  app.setGlobalPrefix(COMMON_CONSTANTS.ROUTES_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: COMMON_CONSTANTS.VERSION });
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) => new ValidationException(errors),
    }),
  );
  app.use(
    ['/docs', '/docs-json', '/docs-yaml'],
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        await app.get(AuthGuard).authenticate(request.headers.authorization);
        next();
      } catch (error) {
        const unauthorized = error instanceof UnauthorizedException;
        response.status(unauthorized ? 401 : 503).json({
          success: false,
          error: {
            code: unauthorized ? 401000 : 503000,
            message: unauthorized ? 'Unauthorized resource' : 'Service temporarily unavailable',
          },
        });
      }
    },
  );
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Program Capacity API — NestJS Core')
      .setVersion('2.0.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, document);
  return app;
}
