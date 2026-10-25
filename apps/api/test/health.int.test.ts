import { healthResponseSchema } from '@classloom/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { createApp } from '../src/main';
import { startTestInfra, type TestInfra } from './setup-containers';

describe('GET /health', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;

  beforeAll(async () => {
    infra = await startTestInfra();
    app = await createApp(infra.env, { logger: false });
    await app.init();
    server = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app?.close();
    await infra?.stop();
  });

  it('reports ok when Postgres and Redis are up', async () => {
    const res = await request(server).get('/health');
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.body)).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('reports 503 with redis down once Redis stops', async () => {
    await infra.redis.stop();
    const res = await request(server).get('/health');
    expect(res.status).toBe(503);
    expect(healthResponseSchema.parse(res.body)).toEqual({
      status: 'error',
      checks: { database: 'up', redis: 'down' },
    });
  });
});
