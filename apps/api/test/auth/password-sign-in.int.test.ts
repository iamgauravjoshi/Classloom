import { authSessionSchema } from '@classloom/contracts';
import { type INestApplication, Logger } from '@nestjs/common';
import argon2 from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types';

import { RedisService } from '../../src/core/redis/redis.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import { identifierKey } from '../../src/modules/auth/crypto';
import { PasswordService } from '../../src/modules/auth/password.service';
import { SessionService } from '../../src/modules/auth/session.service';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';
import { seedSchool } from './helpers';

const WEB_ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct horse battery';
const TITLE = 'Email/mobile or password is incorrect.';

describe('POST /auth/sign-in/password', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let passwords: PasswordService;
  let counter = 0;
  let ipCounter = 0;

  /** Every call gets its own client address unless told otherwise, so the IP limit stays out of the way. */
  const post = (body: Record<string, unknown>, opts: { ip?: string; cookie?: string } = {}) => {
    ipCounter += 1;
    const req = request(server)
      .post('/auth/sign-in/password')
      .set('X-Forwarded-For', opts.ip ?? `198.51.100.${ipCounter}`);
    if (opts.cookie) req.set('Cookie', opts.cookie).set('Origin', WEB_ORIGIN);
    return req.send({ remember: true, ...body });
  };

  async function school(extra: { mobile?: string; password?: string | null } = {}) {
    counter += 1;
    const code = `SIN${counter}`;
    const email = `owner${counter}@sign.in`;
    const ids = await seedSchool(owner, {
      code,
      email,
      mobile: extra.mobile,
      password: extra.password === null ? undefined : (extra.password ?? PASSWORD),
    });
    return { code, email, ...ids };
  }

  const stripInstance = (body: Record<string, unknown>) => {
    const { instance: _instance, ...rest } = body;
    return rest;
  };

  beforeAll(async () => {
    infra = await startTestInfra();
    app = await createApp({ ...infra.env, SIGN_IN_RATE_LIMIT_PER_15_MIN: 3 }, { logger: false });
    await app.init();
    server = app.getHttpServer() as App;
    owner = ownerPrisma(infra.env);
    passwords = new PasswordService();
    expect(await app.get(RedisService).ping(5000)).toBe(true);
  });

  afterAll(async () => {
    await owner?.$disconnect();
    await app?.close();
    await infra?.stop();
  });

  it('signs in by email and by mobile, sets the cookie and records the event', async () => {
    const s = await school({ mobile: '+919876543210' });
    for (const identifier of [s.email.toUpperCase(), '98765 43210']) {
      const res = await post({ schoolCode: s.code.toLowerCase(), identifier, password: PASSWORD });
      expect(res.status).toBe(200);
      const body = authSessionSchema.parse(res.body);
      expect(body.school.code).toBe(s.code);
      expect(body.user.id).toBe(s.userId);
      expect(body.remember).toBe(true);
      expect(res.headers['set-cookie']?.[0]).toMatch(/^cl_session=[\w-]{43};.*HttpOnly/);
    }
    const events = await owner.authEvent.findMany({
      where: { userId: s.userId, type: 'SIGN_IN_SUCCEEDED' },
    });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.method === 'PASSWORD' && e.tenantId === s.tenantId)).toBe(true);
  });

  it('sets a session cookie without max-age when not remembered', async () => {
    const s = await school();
    const res = await post({
      schoolCode: s.code,
      identifier: s.email,
      password: PASSWORD,
      remember: false,
    });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).not.toMatch(/Max-Age/i);
  });

  it('gives the same 401 for every kind of failure', async () => {
    const s = await school();
    const noPassword = await school({ password: null });
    const revoked = await school();
    await owner.membership.update({
      where: { id: revoked.membershipId },
      data: { status: 'REVOKED' },
    });
    const other = await school();

    const attempts = [
      { schoolCode: s.code, identifier: s.email, password: 'wrong password!' },
      { schoolCode: s.code, identifier: 'nobody@sign.in', password: PASSWORD },
      { schoolCode: noPassword.code, identifier: noPassword.email, password: PASSWORD },
      { schoolCode: revoked.code, identifier: revoked.email, password: PASSWORD },
      { schoolCode: s.code, identifier: other.email, password: PASSWORD },
      { schoolCode: 'NOSUCH', identifier: s.email, password: PASSWORD },
    ];
    const bodies: Record<string, unknown>[] = [];
    for (const attempt of attempts) {
      const res = await post(attempt);
      expect(res.status).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.headers['set-cookie']).toBeUndefined();
      bodies.push(stripInstance(res.body as Record<string, unknown>));
    }
    expect(bodies[0]).toMatchObject({ status: 401, title: TITLE });
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });

  it('takes about as long for an unknown email as for a wrong password', async () => {
    // One account per sample keeps every identifier below the 5-failure pause.
    const schools = [];
    for (let i = 0; i < 6; i++) schools.push(await school());
    const time = async (code: string, identifier: string) => {
      const started = process.hrtime.bigint();
      const res = await post({ schoolCode: code, identifier, password: 'wrong password!' });
      expect(res.status).toBe(401);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    await time(schools[0]!.code, schools[0]!.email); // warm up
    // Interleaved, so drifting machine load hits both sides alike.
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 1; i < 6; i++) {
      unknown.push(await time(schools[i]!.code, `ghost${i}@sign.in`));
      known.push(await time(schools[i]!.code, schools[i]!.email));
    }
    const ratio = median(unknown) / median(known);
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(1.4);
  }, 60_000);

  it('pauses after 5 wrong passwords, even for the right one and other spellings', async () => {
    const s = await school();
    const wrong = () =>
      post({ schoolCode: s.code, identifier: s.email, password: 'wrong password!' });
    for (let i = 0; i < 4; i++) expect((await wrong()).status).toBe(401);

    const fifth = await wrong();
    expect(fifth.status).toBe(429);
    expect(fifth.headers['content-type']).toContain('application/problem+json');
    expect(fifth.body).toMatchObject({ status: 429, type: 'sign-in-paused' });
    expect((fifth.body as { retryAfter: number }).retryAfter).toBeGreaterThan(800);
    expect((fifth.body as { retryAfter: number }).retryAfter).toBeLessThanOrEqual(900);
    expect(Number(fifth.headers['retry-after'])).toBeGreaterThan(0);

    const right = await post({ schoolCode: s.code, identifier: s.email, password: PASSWORD });
    expect(right.status).toBe(429);
    expect(right.body).toMatchObject({ type: 'sign-in-paused' });
    expect(right.headers['set-cookie']).toBeUndefined();

    const spelled = await post({
      schoolCode: s.code,
      identifier: ` ${s.email.toUpperCase()}`,
      password: PASSWORD,
    });
    expect(spelled.status).toBe(429);

    const paused = await owner.authEvent.count({
      where: { tenantId: s.tenantId, type: 'SIGN_IN_PAUSED' },
    });
    expect(paused).toBe(1);
    const failed = await owner.authEvent.count({
      where: { tenantId: s.tenantId, type: 'SIGN_IN_FAILED' },
    });
    expect(failed).toBe(4);
  });

  it('pauses an unknown identifier the same way', async () => {
    const s = await school();
    const wrong = () =>
      post({ schoolCode: s.code, identifier: 'ghost@sign.in', password: 'wrong password!' });
    for (let i = 0; i < 4; i++) expect((await wrong()).status).toBe(401);
    const fifth = await wrong();
    expect(fifth.status).toBe(429);
    expect(fifth.body).toMatchObject({ type: 'sign-in-paused' });
  });

  it('does not let one school pause the same person at another', async () => {
    const a = await school();
    const wrong = () =>
      post({ schoolCode: a.code, identifier: a.email, password: 'wrong password!' });
    for (let i = 0; i < 5; i++) await wrong();
    const b = await school();
    const res = await post({ schoolCode: b.code, identifier: b.email, password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('clears the failure count on success', async () => {
    const s = await school();
    const attempt = (password: string) =>
      post({ schoolCode: s.code, identifier: s.email, password });
    for (let i = 0; i < 4; i++) expect((await attempt('wrong password!')).status).toBe(401);
    expect((await attempt(PASSWORD)).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await attempt('wrong password!')).status).toBe(401);
  });

  it('revokes the session the request carried, with REPLACED', async () => {
    const a = await school();
    const b = await school();
    const first = await post({ schoolCode: a.code, identifier: a.email, password: PASSWORD });
    const cookie = (first.headers['set-cookie']?.[0] ?? '').split(';')[0]!;
    const second = await post(
      { schoolCode: b.code, identifier: b.email, password: PASSWORD },
      { cookie },
    );
    expect(second.status).toBe(200);
    const old = await owner.session.findFirstOrThrow({ where: { userId: a.userId } });
    expect(old.revokedReason).toBe('REPLACED');
    expect(old.revokedAt).not.toBeNull();
    const fresh = await owner.session.findFirstOrThrow({ where: { userId: b.userId } });
    expect(fresh.revokedAt).toBeNull();
    const stale = await request(server).get('/auth/session').set('Cookie', cookie);
    expect(stale.status).toBe(401);
  });

  it('does not let parallel wrong guesses past the limit', async () => {
    const s = await school();
    const results = await Promise.all(
      Array.from({ length: 7 }, () =>
        post({ schoolCode: s.code, identifier: s.email, password: 'wrong password!' }),
      ),
    );
    // 5 attempts are counted: 4 fail, the 5th sets the pause; the 2 over the limit are refused.
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([401, 401, 401, 401, 429, 429, 429]);
    const count = (type: 'SIGN_IN_FAILED' | 'SIGN_IN_PAUSED') =>
      owner.authEvent.count({ where: { userId: s.userId, type } });
    expect(await count('SIGN_IN_FAILED')).toBe(4);
    expect(await count('SIGN_IN_PAUSED')).toBe(1);

    const after = await post({ schoolCode: s.code, identifier: s.email, password: PASSWORD });
    expect(after.status).toBe(429);
    expect(await owner.session.count({ where: { userId: s.userId } })).toBe(0);
  });

  it('refuses the right password once the window attempts are used up', async () => {
    const s = await school();
    const key = `auth:fail:${s.tenantId}:${identifierKey(infra.env.AUTH_SECRET, s.tenantId, s.email)}`;
    await app.get(RedisService).client.set(key, '6', 'EX', 900);
    const res = await post({ schoolCode: s.code, identifier: s.email, password: PASSWORD });
    expect(res.status).toBe(429);
    expect(await owner.session.count({ where: { userId: s.userId } })).toBe(0);
  });

  it('does not let a sign-in in flight outlive a password reset', async () => {
    const s = await school();
    // Old parameters, so the sign-in also tries to re-hash over the reset.
    const old = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 4096,
      timeCost: 2,
      parallelism: 1,
    });
    await owner.user.update({ where: { id: s.userId }, data: { passwordHash: old } });
    const resetHash = await passwords.hash('purple elephant dances');
    const service = app.get(PasswordService);
    const verify = service.verify.bind(service);
    const spy = vi.spyOn(service, 'verify').mockImplementationOnce(async (hash, password) => {
      const ok = await verify(hash, password);
      // The reset commits after the hash was read and checked, before the session is created.
      await app.get(SessionService).changePassword(s.userId, {
        passwordHash: resetHash,
        reason: 'PASSWORD_RESET',
      });
      return ok;
    });
    const res = await post({ schoolCode: s.code, identifier: s.email, password: PASSWORD });
    spy.mockRestore();
    expect(res.status).toBe(401);
    expect(stripInstance(res.body as Record<string, unknown>)).toMatchObject({ title: TITLE });
    expect(await owner.session.count({ where: { userId: s.userId, revokedAt: null } })).toBe(0);
    const user = await owner.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(user.passwordHash).toBe(resetHash);
  });

  it('shares one address limit between password sign-in and code verification', async () => {
    const ip = '203.0.113.77';
    const s = await school();
    const verifyCode = () =>
      request(server)
        .post('/auth/otp/verify')
        .set('X-Forwarded-For', ip)
        .send({ schoolCode: s.code, email: 'ghost@sign.in', code: '123456', remember: true });
    const password = () =>
      post({ schoolCode: s.code, identifier: 'ghost@sign.in', password: 'wrong password!' }, { ip });
    // The limit is 3 in this suite: 2 + 1 use it up, though neither route reached 3 alone.
    expect((await password()).status).toBe(401);
    expect((await password()).status).toBe(401);
    expect((await verifyCode()).status).toBe(401);
    expect((await verifyCode()).status).toBe(429);
    expect((await password()).status).toBe(429);
  });

  it('re-hashes a password stored with old parameters', async () => {
    const s = await school();
    const old = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 4096,
      timeCost: 2,
      parallelism: 1,
    });
    await owner.user.update({ where: { id: s.userId }, data: { passwordHash: old } });
    const res = await post({ schoolCode: s.code, identifier: s.email, password: PASSWORD });
    expect(res.status).toBe(200);
    const user = await owner.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(user.passwordHash).not.toBe(old);
    expect(passwords.needsRehash(user.passwordHash!)).toBe(false);
    expect(await passwords.verify(user.passwordHash!, PASSWORD)).toBe(true);
  });

  it('rejects an invalid body with 400', async () => {
    const res = await post({ schoolCode: 'GISD', identifier: 'x@y.in', password: '' });
    expect(res.status).toBe(400);
  });

  it('limits attempts per client address without the pause type', async () => {
    const ip = '203.0.113.50';
    const s = await school();
    const attempt = () =>
      post(
        { schoolCode: s.code, identifier: 'ghost@sign.in', password: 'wrong password!' },
        { ip },
      );
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const res = await attempt();
    expect(res.status).toBe(429);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect((res.body as { type: string }).type).not.toBe('sign-in-paused');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  // Keep last: it stops Redis for the rest of the suite.
  it('still signs in while Redis is down, logging a warning', async () => {
    const s = await school();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await infra.redis.stop();
    try {
      const res = await post({
        schoolCode: s.code,
        identifier: s.email,
        password: PASSWORD,
      }).timeout(15_000);
      expect(res.status).toBe(200);
      expect(warn).toHaveBeenCalled();
      expect(
        warn.mock.contexts.some(
          (c) => (c as { context?: string }).context === 'SignInPauseService',
        ),
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  }, 30_000);
});
