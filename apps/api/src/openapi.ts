import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Env } from './core/config/env.schema';
import { buildOpenApiDocument, createApp } from './main';

/** Writes the OpenAPI document consumed by `@classloom/api-client` (Orval). Needs no database. */
async function exportOpenApi(): Promise<void> {
  const env: Env = {
    NODE_ENV: 'test',
    API_PORT: 0,
    DATABASE_URL: 'postgresql://openapi:openapi@127.0.0.1:1/openapi',
    REDIS_URL: 'redis://127.0.0.1:1',
    SMTP_URL: 'smtp://127.0.0.1:1',
    EMAIL_FROM: 'Classloom <no-reply@classloom.local>',
    REGISTRATION_RATE_LIMIT_PER_HOUR: 5,
    CODE_AVAILABILITY_RATE_LIMIT_PER_MINUTE: 60,
    RESEND_RATE_LIMIT_PER_HOUR: 10,
    REGISTRATION_TOKEN_TTL_HOURS: 24,
    PENDING_TENANT_TTL_HOURS: 48,
    WEB_ORIGIN: 'http://localhost:3000',
    AUTH_SECRET: 'openapi-export-only-secret-0123456789',
    TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7),
    COOKIE_SECURE: false,
    TRUST_PROXY: 'loopback',
    SIGN_IN_RATE_LIMIT_PER_15_MIN: 30,
    CODE_REQUEST_RATE_LIMIT_PER_HOUR: 10,
    PASSWORD_RESET_RATE_LIMIT_PER_HOUR: 10,
  };
  const app = await createApp(env, { logger: false });
  const target = resolve(__dirname, '../../../packages/api-client/openapi.json');
  writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(app, env), null, 2)}\n`);
  console.log(`OpenAPI written to ${target}`);
  // The app was never initialised (no Redis or database), so Nest's shutdown hooks may throw.
  await app.close().catch(() => undefined);
}

void exportOpenApi().then(() => process.exit(0));
