import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { PrismaService } from '../../src/core/prisma/prisma.service';
import { createApp } from '../../src/main';
import { startTestInfra, type TestInfra } from '../setup-containers';

describe('school code availability and public lookup', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let prisma: PrismaService;

  async function seed(code: string, status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION') {
    await prisma.tenant.create({
      data: {
        code,
        name: `School ${code}`,
        board: 'CBSE',
        city: 'Dehradun',
        state: 'UK',
        contactEmail: `admin@${code.toLowerCase()}.in`,
        termsAcceptedAt: new Date(),
        status,
      },
    });
  }

  beforeAll(async () => {
    infra = await startTestInfra();
    app = await createApp(infra.env, { logger: false });
    await app.init();
    server = app.getHttpServer() as App;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
    await infra?.stop();
  });

  it('reports a free code as available (empty DB)', async () => {
    const res = await request(server).get('/schools/code-availability').query({ code: 'gisd' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: 'GISD', available: true });
  });

  it('reports reserved and invalid codes', async () => {
    const reserved = await request(server).get('/schools/code-availability?code=admin');
    expect(reserved.body).toMatchObject({ available: false, reason: 'reserved' });
    const invalid = await request(server).get('/schools/code-availability?code=1x');
    expect(invalid.body).toMatchObject({ available: false, reason: 'invalid' });
  });

  it('reports a taken code and suggests the next free one', async () => {
    await seed('GISD', 'ACTIVE');
    const res = await request(server)
      .get('/schools/code-availability')
      .query({ code: 'gisd', name: 'Global International School', city: 'Dehradun' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      code: 'GISD',
      available: false,
      reason: 'taken',
      suggestion: 'GISD-2',
    });
  });

  it('suggests a code when none is supplied', async () => {
    const res = await request(server)
      .get('/schools/code-availability')
      .query({ name: 'Global International School', city: 'Dehradun' });
    expect(res.status).toBe(200);
    expect((res.body as { suggestion?: string }).suggestion).toBe('GISD-2');
  });

  it('serves the public profile of an active school case-insensitively', async () => {
    const res = await request(server).get('/schools/gisd/public');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body as object).sort()).toEqual(['city', 'code', 'name', 'state']);
    expect(res.body).toEqual({
      code: 'GISD',
      name: 'School GISD',
      city: 'Dehradun',
      state: 'UK',
    });
  });

  it.each(['SUSPENDED', 'PENDING_VERIFICATION'] as const)(
    '404s for a %s school',
    async (status) => {
      const code = status === 'SUSPENDED' ? 'SUSP' : 'PEND';
      await seed(code, status);
      const res = await request(server).get(`/schools/${code}/public`);
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
    },
  );

  it('404s for an unknown or malformed code', async () => {
    expect((await request(server).get('/schools/NOPE/public')).status).toBe(404);
    expect((await request(server).get('/schools/!!/public')).status).toBe(404);
  });
});
