import { problemDetailsSchema } from '@classloom/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { createApp } from '../src/main';
import { startTestInfra, type TestInfra } from './setup-containers';

describe('error responses', () => {
  let infra: TestInfra;
  let app: INestApplication;

  beforeAll(async () => {
    infra = await startTestInfra();
    app = await createApp({ ...infra.env, NODE_ENV: 'production' }, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await infra?.stop();
  });

  it('returns problem+json for unknown routes', async () => {
    const res = await request(app.getHttpServer() as App).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    const body = problemDetailsSchema.parse(JSON.parse(res.text));
    expect(body).toMatchObject({ status: 404, title: 'Not Found', instance: '/does-not-exist' });
    expect(res.text).not.toContain('stack');
  });

  it('sets security headers', async () => {
    const res = await request(app.getHttpServer() as App).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
