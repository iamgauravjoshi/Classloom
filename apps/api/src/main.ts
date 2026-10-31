import 'reflect-metadata';

import type { INestApplication, NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';

import { AppModule } from './app.module';
import { type Env, parseEnv } from './core/config/env.schema';
import { restoreNullable } from './core/http/nullable-openapi';
import { sessionCookieName } from './modules/auth/session-cookie';

export function buildOpenApiDocument(app: INestApplication, env: Env): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Classloom API')
    .setDescription('Multi-school management SaaS for Indian schools')
    .setVersion('0.0.0')
    // nestjs-zod writes nested nullables as `type: [..., 'null']`, which only 3.1 allows.
    .setOpenAPIVersion('3.1.0')
    .addCookieAuth(sessionCookieName(env))
    .build();
  return restoreNullable(cleanupOpenApiDoc(SwaggerModule.createDocument(app, config)));
}

/** Express wants a count or boolean as such, and anything else as an address list. */
export function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return /^\d+$/.test(value) ? Number(value) : value;
}

/** HTTP setup shared by the real app and by integration tests that assemble their own module. */
export function configureApp(app: INestApplication, env: Env): void {
  (app as NestExpressApplication).set('trust proxy', parseTrustProxy(env.TRUST_PROXY));
  app.use(helmet());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();
  // Served by the HTTP adapter outside Nest routing, so the global AuthGuard never sees these.
  SwaggerModule.setup('docs', app, () => buildOpenApiDocument(app, env), {
    jsonDocumentUrl: 'docs-json',
  });
}

/** Builds a fully configured app without listening; used by `bootstrap`, integration tests and the OpenAPI export. */
export async function createApp(
  env: Env,
  options: NestApplicationOptions = { bufferLogs: true },
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(env), options);
  if (options.logger !== false) app.useLogger(app.get(Logger));
  configureApp(app, env);
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
