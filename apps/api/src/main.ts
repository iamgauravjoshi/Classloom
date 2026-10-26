import 'reflect-metadata';

import type { INestApplication, NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';

import { AppModule } from './app.module';
import { type Env, parseEnv } from './core/config/env.schema';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Classloom API')
    .setDescription('Multi-school management SaaS for Indian schools')
    .setVersion('0.0.0')
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}

/** Builds a fully configured app without listening; used by `bootstrap`, integration tests and the OpenAPI export. */
export async function createApp(
  env: Env,
  options: NestApplicationOptions = { bufferLogs: true },
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(env), options);
  if (options.logger !== false) app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();
  SwaggerModule.setup('docs', app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'docs-json',
  });
  return app;
}

async function bootstrap(): Promise<void> {
  const env = parseEnv(process.env);
  const app = await createApp(env);
  await app.listen(env.API_PORT);
}

if (require.main === module) {
  void bootstrap();
}
