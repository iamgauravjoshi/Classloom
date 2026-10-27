import { authSessionSchema } from '@classloom/contracts';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/core/prisma/prisma.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { configureApp } from '../../src/main';
import { SessionService } from '../../src/modules/auth/session.service';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';
import { seedSchool } from './helpers';

@Controller('__probe')
class ProbeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  campuses() {
    return this.prisma.scoped.campus.findMany({ select: { name: true } });
  }
}

const COOKIE = 'cl_session';
const WEB_ORIGIN = 'http://localhost:3000';
const CLEARED = /^cl_session=;/;

describe('request pipeline', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let sessions: SessionService;
  let counter = 0;

  async function signedIn(remember = true) {
    counter += 1;
    const code = `PIPE${counter}`;
    const ids = await seedSchool(owner, { code, email: `o${counter}@pipe.in` });
    const { token, session } = await sessions.create({ ...ids, remember });
    return { code, ...ids, token, session, cookie: `${COOKIE}=${token}` };
  }

  beforeAll(async () => {
    infra = await startTestInfra();
    const env = { ...infra.env, DATABASE_MIGRATION_URL: undefined };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, env);
    await app.init();
    server = app.getHttpServer() as App;
    owner = ownerPrisma(infra.env);
    sessions = app.get(SessionService, { strict: false });
  });

  afterAll(async () => {
    await owner?.$disconnect();
    await app?.close();
    await infra?.stop();
  });

  describe('GET /auth/session', () => {
    it('is 401 problem+json without a cookie', async () => {
      const res = await request(server).get('/auth/session');
      expect(res.status).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
    });

    it('returns the session for a valid cookie', async () => {
      const s = await signedIn();
      const res = await request(server).get('/auth/session').set('Cookie', s.cookie);
      expect(res.status).toBe(200);
      const body = authSessionSchema.parse(res.body);
      expect(body.school.code).toBe(s.code);
      expect(body.school.code).toBe(body.school.code.toUpperCase());
      expect(body.role).toBe('OWNER');
      const primary = await owner.campus.findFirstOrThrow({
        where: { tenantId: s.tenantId, isPrimary: true },
      });
      expect(body.campus).toEqual({ id: primary.id, name: primary.name });
      expect(body.user.id).toBe(s.userId);
    });

    it('clears the cookie for an unknown token', async () => {
      const res = await request(server).get('/auth/session').set('Cookie', `${COOKIE}=nope`);
      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']?.[0]).toMatch(CLEARED);
    });

    it('refuses revoked and expired sessions and clears the cookie', async () => {
      const revoked = await signedIn();
      await sessions.revoke(revoked.session.id, 'SIGNED_OUT');
      const expired = await signedIn();
      await owner.session.update({
        where: { id: expired.session.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      for (const s of [revoked, expired]) {
        const res = await request(server).get('/auth/session').set('Cookie', s.cookie);
        expect(res.status).toBe(401);
        expect(res.headers['set-cookie']?.[0]).toMatch(CLEARED);
      }
    });

    it('follows the school status on the next request', async () => {
      const s = await signedIn();
      const get = () => request(server).get('/auth/session').set('Cookie', s.cookie);
      await owner.tenant.update({ where: { id: s.tenantId }, data: { status: 'SUSPENDED' } });
      expect((await get()).status).toBe(401);
      await owner.tenant.update({ where: { id: s.tenantId }, data: { status: 'ACTIVE' } });
      expect((await get()).status).toBe(200);
    });

    it('refuses a revoked membership', async () => {
      const s = await signedIn();
      await owner.membership.update({ where: { id: s.membershipId }, data: { status: 'REVOKED' } });
      const res = await request(server).get('/auth/session').set('Cookie', s.cookie);
      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']?.[0]).toMatch(CLEARED);
    });
  });

  it('runs the handler inside the session school tenant context', async () => {
    const a = await signedIn();
    const b = await signedIn();
    const res = await request(server).get('/__probe').set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ name: `School ${a.code}` }]);
    expect(JSON.stringify(res.body)).not.toContain(b.code);
    expect((await request(server).get('/__probe')).status).toBe(401);
  });

  describe('POST /auth/sign-out', () => {
    it('refuses a foreign or missing Origin when the cookie is sent', async () => {
      const s = await signedIn();
      const res = await request(server)
        .post('/auth/sign-out')
        .set('Cookie', s.cookie)
        .set('Origin', 'http://evil.example');
      expect(res.status).toBe(403);
      const missing = await request(server).post('/auth/sign-out').set('Cookie', s.cookie);
      expect(missing.status).toBe(403);
      const row = await owner.session.findUniqueOrThrow({ where: { id: s.session.id } });
      expect(row.revokedAt).toBeNull();
    });

    it('revokes, clears the cookie and records the event', async () => {
      const s = await signedIn();
      const res = await request(server)
        .post('/auth/sign-out')
        .set('Cookie', s.cookie)
        .set('Origin', WEB_ORIGIN);
      expect(res.status).toBe(204);
      expect(res.headers['set-cookie']?.[0]).toMatch(CLEARED);
      const row = await owner.session.findUniqueOrThrow({ where: { id: s.session.id } });
      expect(row.revokedReason).toBe('SIGNED_OUT');
      const event = await owner.authEvent.findFirstOrThrow({
        where: { sessionId: s.session.id, type: 'SIGNED_OUT' },
      });
      expect(event.userId).toBe(s.userId);
      expect(event.tenantId).toBe(s.tenantId);
      const again = await request(server).post('/auth/sign-out');
      expect(again.status).toBe(204);
    });

    it('records the forwarded client address from a trusted proxy', async () => {
      const s = await signedIn();
      await request(server)
        .post('/auth/sign-out')
        .set('Cookie', s.cookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-Forwarded-For', '203.0.113.9')
        .expect(204);
      const event = await owner.authEvent.findFirstOrThrow({
        where: { sessionId: s.session.id, type: 'SIGNED_OUT' },
      });
      expect(event.ip).toBe('203.0.113.9');
    });
  });

  it('keeps public routes open without a cookie', async () => {
    expect((await request(server).get('/health')).status).toBe(200);
    expect((await request(server).get('/schools/code-availability?code=zzzz')).status).toBe(200);
    expect((await request(server).get('/docs-json')).status).toBe(200);
    expect((await request(server).get('/docs')).status).toBeLessThan(400);
  });
});
