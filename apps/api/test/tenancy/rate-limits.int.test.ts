import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { RedisService } from '../../src/core/redis/redis.service';
import { createApp } from '../../src/main';
import { startTestInfra, type TestInfra } from '../setup-containers';

const payload = (n: number) => ({
  schoolName: 'Global International School',
  board: 'CBSE',
  city: 'Dehradun',
  state: 'UK',
  code: `GIS${n}`,
  adminName: 'Asha Rawat',
  email: `asha${n}@school.in`,
  acceptTerms: true,
});

describe('rate limits on public endpoints', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;

  beforeAll(async () => {
    infra = await startTestInfra({ mailpit: true });
    app = await createApp({ ...infra.env, REGISTRATION_RATE_LIMIT_PER_HOUR: 2 }, { logger: false });
    await app.init();
    server = app.getHttpServer() as App;
    // The Redis client connects lazily; a request before it is ready would fail open.
    expect(await app.get(RedisService).ping(5000)).toBe(true);
  });

  afterAll(async () => {
    await app?.close();
    await infra?.stop();
  });

  it('limits registrations per client and ignores X-Forwarded-For', async () => {
    const first = await request(server).post('/school-registrations').send(payload(1));
    expect(first.status).toBe(202);
    const second = await request(server)
      .post('/school-registrations')
      .set('X-Forwarded-For', '203.0.113.7')
      .send(payload(2));
    expect(second.status).toBe(202);

    const third = await request(server)
      .post('/school-registrations')
      .set('X-Forwarded-For', '203.0.113.99')
      .send(payload(3));
    expect(third.status).toBe(429);
    expect(third.headers['content-type']).toContain('application/problem+json');
    expect(third.body).toMatchObject({ status: 429, title: 'Too Many Requests' });
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('does not throttle verify or resend with the registration limit', async () => {
    const res = await request(server).post('/school-registrations/verify').send({ token: 'x' });
    expect(res.status).not.toBe(429);
  });

  it('limits resend to 10 per hour per client, across emails and codes', async () => {
    const resend = (n: number) =>
      request(server)
        .post('/school-registrations/resend')
        .send({ email: `someone${n}@school.in`, code: `RSD${n}` });
    for (let n = 1; n <= 10; n++) expect((await resend(n)).status).toBe(202);
    const res = await resend(11);
    expect(res.status).toBe(429);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 429, title: 'Too Many Requests' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('limits code availability to 60 per minute', async () => {
    for (let i = 0; i < 60; i++) {
      const res = await request(server).get('/schools/code-availability').query({ code: 'gisd' });
      expect(res.status).toBe(200);
    }
    const res = await request(server).get('/schools/code-availability').query({ code: 'gisd' });
    expect(res.status).toBe(429);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });
});
