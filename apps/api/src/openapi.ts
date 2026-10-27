import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildOpenApiDocument, createApp } from './main';

/** Writes the OpenAPI document consumed by `@classloom/api-client` (Orval). Needs no database. */
async function exportOpenApi(): Promise<void> {
  const app = await createApp(
    {
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
    },
    { logger: false },
  );
  const target = resolve(__dirname, '../../../packages/api-client/openapi.json');
  writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`);
  console.log(`OpenAPI written to ${target}`);
  // The app was never initialised (no Redis or database), so Nest's shutdown hooks may throw.
  await app.close().catch(() => undefined);
}

void exportOpenApi().then(() => process.exit(0));
