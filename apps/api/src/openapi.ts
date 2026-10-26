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
      WEB_ORIGIN: 'http://localhost:3000',
    },
    { logger: false },
  );
  const target = resolve(__dirname, '../../../packages/api-client/openapi.json');
  writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`);
  await app.close();
  console.log(`OpenAPI written to ${target}`);
}

void exportOpenApi();
