import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { PrismaService } from '../../src/core/prisma/prisma.service';
import { RedisService } from '../../src/core/redis/redis.service';
import { createApp } from '../../src/main';
import { startTestInfra, type TestInfra } from '../setup-containers';

const payload = (code: string, email: string) => ({
  schoolName: 'Global International School',
  board: 'CBSE',
  city: 'Dehradun',
  state: 'UK',
  code,
  adminName: 'Asha Rawat',
  email,
  acceptTerms: true,
});

describe('registration while Redis is down', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let prisma: PrismaService;

  beforeAll(async () => {
    infra = await startTestInfra({ mailpit: true });
    app = await createApp(infra.env, { logger: false });
    await app.init();
    server = app.getHttpServer() as App;
    prisma = app.get(PrismaService);
    expect(await app.get(RedisService).ping(5000)).toBe(true);
  });

  afterAll(async () => {
    await app?.close();
    await infra?.stop();
  });

  it('registers normally while Redis is up', async () => {
    const res = await request(server)
      .post('/school-registrations')
      .send(payload('UPSC', 'up@school.in'));
    expect(res.status).toBe(202);
  });

  it('fails fast with a problem response and stores nothing once Redis stops', async () => {
    await infra.redis.stop();

    const started = Date.now();
    // Without a fail-fast producer this waits for Redis forever; the timeout turns that into a
    // test failure instead of a hung suite.
    const res = await request(server)
      .post('/school-registrations')
      .timeout(10_000)
      .send(payload('DOWN', 'down@school.in'));
    const elapsed = Date.now() - started;

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(elapsed).toBeLessThan(4000);
    expect(await prisma.tenant.count({ where: { code: 'DOWN' } })).toBe(0);
    expect(await prisma.user.count({ where: { email: 'down@school.in' } })).toBe(0);
    expect(await prisma.registrationToken.count()).toBe(1); // only UPSC's
  });
});
