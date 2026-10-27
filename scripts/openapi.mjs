import './runtime-env.mjs';
import { writeFile } from 'node:fs/promises';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { createApplication } from '../dist/core/app/create-application.js';

const app = await createApplication();
try {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Program Capacity API — NestJS Core')
      .setVersion('2.0.0')
      .addBearerAuth()
      .build(),
  );
  await writeFile(
    process.env.OPENAPI_OUTPUT ?? 'openapi.json',
    JSON.stringify(document, null, 2) + '\n',
  );
} finally {
  await app.close();
}
