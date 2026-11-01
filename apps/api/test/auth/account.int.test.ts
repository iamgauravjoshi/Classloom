import { meSchema, problemDetailsSchema } from '@classloom/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import { PasswordService } from '../../src/modules/auth/password.service';
import { SessionService } from '../../src/modules/auth/session.service';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';
import { seedSchool } from './helpers';

const WEB_ORIGIN = 'http://localhost:3000';
const COOKIE = 'cl_session';
const OLD_PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'purple elephant dances';
const MINUTE = 60_000;

interface Problem {
  type?: string;
  errors?: { path: string; code?: string }[];
}

describe('my account', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let sessions: SessionService;
  let passwords: PasswordService;
  let counter = 0;
  let ipCounter = 0;

  async function account(
    opts: { password?: string; mobile?: string; authenticatedMinutesAgo?: number } = {},
  ) {
    counter += 1;
    const code = `ACC${counter}`;
    const email = `owner${counter}@account.test`;
    const ids = await seedSchool(owner, {
      code,
      email,
      mobile: opts.mobile,
      password: opts.password,
    });
    const { token, session } = await sessions.create({ ...ids, remember: true });
    if (opts.authenticatedMinutesAgo !== undefined) {
      await owner.session.update({
        where: { id: session.id },
        data: { authenticatedAt: new Date(Date.now() - opts.authenticatedMinutesAgo * MINUTE) },
      });
    }
    return { code, email, ...ids, sessionId: session.id, cookie: `${COOKIE}=${token}` };
  }

  const get = (cookie?: string) => {
    const req = request(server).get('/me');
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const patch = (cookie: string, body: object) =>
    request(server).patch('/me').set('Cookie', cookie).set('Origin', WEB_ORIGIN).send(body);
  const put = (cookie: string, body: object) =>
    request(server).put('/me/password').set('Cookie', cookie).set('Origin', WEB_ORIGIN).send(body);

  beforeAll(async () => {
    infra = await startTestInfra();
    app = await createApp(infra.env, { logger: false });
    await app.init();
    server = app.getHttpServer() as App;
    owner = ownerPrisma(infra.env);
    sessions = app.get(SessionService, { strict: false });
    passwords = new PasswordService();
  });

  afterAll(async () => {
    await owner?.$disconnect();
    await app?.close();
    await infra?.stop();
  });

  describe('GET /me', () => {
    it('returns the signed-in user', async () => {
      const a = await account({ password: OLD_PASSWORD });
      const res = await get(a.cookie);
      expect(res.status).toBe(200);
      const me = meSchema.parse(res.body);
      expect(me).toMatchObject({
        id: a.userId,
        email: a.email,
        emailVerified: true,
        mobile: null,
        hasPassword: true,
      });
    });

    it('is 401 when signed out', async () => {
      const res = await get();
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /me', () => {
    it('changes the name and normalises the mobile', async () => {
      const a = await account();
      const res = await patch(a.cookie, { name: '  Anita Sharma ', mobile: '98765 43210' });
      expect(res.status).toBe(200);
      expect(meSchema.parse(res.body)).toMatchObject({
        name: 'Anita Sharma',
        mobile: '+919876543210',
      });
      const row = await owner.user.findUniqueOrThrow({ where: { id: a.userId } });
      expect(row.mobile).toBe('+919876543210');
    });

    it('clears the mobile with null and keeps it when left out', async () => {
      const a = await account({ mobile: '+919876500101' });
      const kept = await patch(a.cookie, { name: 'New Name' });
      expect(kept.body).toMatchObject({ mobile: '+919876500101' });
      const cleared = await patch(a.cookie, { mobile: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body).toMatchObject({ mobile: null, name: 'New Name' });
    });

    it('refuses a mobile held by another user with 409 on the mobile field', async () => {
      await account({ mobile: '+919876500102' });
      const b = await account();
      const res = await patch(b.cookie, { mobile: '9876500102' });
      expect(res.status).toBe(409);
      const problem = problemDetailsSchema.parse(res.body);
      expect(problem.errors?.map((e) => e.path)).toEqual(['mobile']);
    });

    it('allows keeping your own mobile', async () => {
      const a = await account({ mobile: '+919876500103' });
      const res = await patch(a.cookie, { mobile: '9876500103' });
      expect(res.status).toBe(200);
    });

    it('answers 429 on the 21st change in an hour, per user', async () => {
      const a = await account();
      for (let i = 0; i < 20; i += 1) {
        const ok = await patch(a.cookie, { name: `Name ${i + 10}` });
        expect(ok.status).toBe(200);
      }
      const limited = await patch(a.cookie, { name: 'One too many' });
      expect(limited.status).toBe(429);
      expect(limited.headers['retry-after']).toBeDefined();

      const other = await account();
      expect((await patch(other.cookie, { name: 'Someone Else' })).status).toBe(200);
    });

    it('does not count a request that changes nothing', async () => {
      const a = await account();
      for (let i = 0; i < 25; i += 1) expect((await patch(a.cookie, {})).status).toBe(200);
      expect((await patch(a.cookie, { name: 'Still Fine' })).status).toBe(200);
    });

    it('is 401 when signed out', async () => {
      const res = await request(server).patch('/me').set('Origin', WEB_ORIGIN).send({ name: 'Xy' });
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /me/password, first set', () => {
    it('sets the password after a recent sign-in, keeping this session and ending the others', async () => {
      const a = await account({ authenticatedMinutesAgo: 5 });
      const other = await sessions.create({
        userId: a.userId,
        tenantId: a.tenantId,
        membershipId: a.membershipId,
        remember: false,
      });

      const res = await put(a.cookie, { newPassword: NEW_PASSWORD });
      expect(res.status).toBe(204);

      const user = await owner.user.findUniqueOrThrow({ where: { id: a.userId } });
      expect(user.passwordHash).not.toBeNull();
      expect(await passwords.verify(user.passwordHash ?? '', NEW_PASSWORD)).toBe(true);
      expect(user.passwordChangedAt).not.toBeNull();

      const revoked = await owner.session.findUniqueOrThrow({ where: { id: other.session.id } });
      expect(revoked.revokedReason).toBe('PASSWORD_CHANGED');
      expect((await get(a.cookie)).status).toBe(200);
      expect(
        await owner.authEvent.count({ where: { userId: a.userId, type: 'PASSWORD_SET' } }),
      ).toBe(1);
    });

    it('asks for a new sign-in when the last one was over 10 minutes ago', async () => {
      const a = await account({ authenticatedMinutesAgo: 11 });
      const res = await put(a.cookie, { newPassword: NEW_PASSWORD });
      expect(res.status).toBe(403);
      const problem = problemDetailsSchema.parse(res.body);
      expect(problem.type.endsWith('recent-sign-in-required')).toBe(true);
      const user = await owner.user.findUniqueOrThrow({ where: { id: a.userId } });
      expect(user.passwordHash).toBeNull();
    });

    it('refuses a password the policy rejects', async () => {
      const a = await account({ authenticatedMinutesAgo: 1 });
      const res = await put(a.cookie, { newPassword: `${a.email}xyz` });
      expect(res.status).toBe(400);
      expect((res.body as Problem).errors).toEqual([
        expect.objectContaining({ path: 'newPassword', code: 'contains_email' }),
      ]);
      const code = await put(a.cookie, { newPassword: `my${a.code.toLowerCase()}pass99` });
      expect((code.body as Problem).errors).toEqual([
        expect.objectContaining({ path: 'newPassword', code: 'contains_school_code' }),
      ]);
    });
  });

  describe('PUT /me/password, change', () => {
    it('needs the current password, and a wrong one is a 400 on currentPassword', async () => {
      const a = await account({ password: OLD_PASSWORD });
      const missing = await put(a.cookie, { newPassword: NEW_PASSWORD });
      expect(missing.status).toBe(400);
      expect((missing.body as Problem).errors).toEqual([
        expect.objectContaining({ path: 'currentPassword' }),
      ]);
      const wrong = await put(a.cookie, {
        currentPassword: 'not it at all',
        newPassword: NEW_PASSWORD,
      });
      expect(wrong.status).toBe(400);
      expect((wrong.body as Problem).errors).toEqual([
        expect.objectContaining({ path: 'currentPassword' }),
      ]);
      const user = await owner.user.findUniqueOrThrow({ where: { id: a.userId } });
      expect(await passwords.verify(user.passwordHash ?? '', OLD_PASSWORD)).toBe(true);
    });

    it('pauses password sign-in after 5 wrong current passwords', async () => {
      const a = await account({ password: OLD_PASSWORD });
      for (let i = 0; i < 5; i += 1) {
        const res = await put(a.cookie, {
          currentPassword: `wrong guess ${i}`,
          newPassword: NEW_PASSWORD,
        });
        expect(res.status).toBe(i < 4 ? 400 : 429);
      }
      const signIn = await request(server)
        .post('/auth/sign-in/password')
        .set('X-Forwarded-For', `192.0.2.${(ipCounter += 1)}`)
        .send({ schoolCode: a.code, identifier: a.email, password: OLD_PASSWORD, remember: true });
      expect(signIn.status).toBe(429);
      expect((signIn.body as Problem).type).toMatch(/sign-in-paused$/);
      const blocked = await put(a.cookie, {
        currentPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      expect(blocked.status).toBe(429);
    });

    it('changes the password with the right current one, ending other sessions only', async () => {
      const a = await account({ password: OLD_PASSWORD, authenticatedMinutesAgo: 60 });
      const other = await sessions.create({
        userId: a.userId,
        tenantId: a.tenantId,
        membershipId: a.membershipId,
        remember: false,
      });
      const res = await put(a.cookie, { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
      expect(res.status).toBe(204);
      const user = await owner.user.findUniqueOrThrow({ where: { id: a.userId } });
      expect(await passwords.verify(user.passwordHash ?? '', NEW_PASSWORD)).toBe(true);
      const revoked = await owner.session.findUniqueOrThrow({ where: { id: other.session.id } });
      expect(revoked.revokedReason).toBe('PASSWORD_CHANGED');
      expect((await get(a.cookie)).status).toBe(200);
      expect(
        await owner.authEvent.count({ where: { userId: a.userId, type: 'PASSWORD_CHANGED' } }),
      ).toBe(1);
    });

    it('applies the password policy', async () => {
      const a = await account({ password: OLD_PASSWORD });
      const res = await put(a.cookie, {
        currentPassword: OLD_PASSWORD,
        newPassword: 'password123',
      });
      expect(res.status).toBe(400);
      expect((res.body as Problem).errors).toEqual([
        expect.objectContaining({ path: 'newPassword', code: 'common' }),
      ]);
    });
  });
});
