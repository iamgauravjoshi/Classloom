import { authSessionSchema, twoFactorChallengeSchema } from '@classloom/contracts';
import type { INestApplication } from '@nestjs/common';
import { generateSync } from 'otplib';
import request from 'supertest';
import type { App } from 'supertest/types';

import { RedisService } from '../../src/core/redis/redis.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import { hmac, sha256 } from '../../src/modules/auth/crypto';
import { PasswordService } from '../../src/modules/auth/password.service';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normaliseRecoveryCode,
} from '../../src/modules/auth/recovery-codes';
import { encryptSecret } from '../../src/modules/auth/secret-box';
import { SessionService } from '../../src/modules/auth/session.service';
import { generateTotpSecret } from '../../src/modules/auth/totp';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';
import { addMember, seedSchool } from './helpers';

const PASSWORD = 'correct horse battery';
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const NEW_DEVICE_SUBJECT = 'New sign-in to your Classloom account';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface MailpitSummary {
  ID: string;
  Subject: string;
}

interface Account {
  code: string;
  email: string;
  tenantId: string;
  userId: string;
  membershipId: string;
  secret: string;
  recovery: string[];
}

describe('two-step at sign-in', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let redis: RedisService;
  let passwords: PasswordService;
  let counter = 0;
  let ipCounter = 0;

  const ip = () => `192.0.2.${((ipCounter += 1) % 250) + 1}`;

  /** The value of `name` among the response's Set-Cookie headers. */
  function cookieOf(res: request.Response, name: string): string | undefined {
    const raw = res.headers['set-cookie'] as unknown as string[] | string | undefined;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const line of list) {
      const [pair] = line.split(';');
      const eq = pair?.indexOf('=') ?? -1;
      if (pair && eq > 0 && pair.slice(0, eq) === name) return pair.slice(eq + 1);
    }
    return undefined;
  }

  const withDevice = (req: request.Test, device?: string) =>
    device ? req.set('Cookie', `cl_device=${device}`) : req;

  const passwordSignIn = (
    s: { code: string; email: string },
    opts: { device?: string; password?: string } = {},
  ) =>
    withDevice(
      request(server)
        .post('/auth/sign-in/password')
        .set('X-Forwarded-For', ip())
        .set('User-Agent', CHROME),
      opts.device,
    ).send({
      schoolCode: s.code,
      identifier: s.email,
      password: opts.password ?? PASSWORD,
      remember: true,
    });

  const verify = (body: Record<string, unknown>, device?: string) =>
    withDevice(
      request(server)
        .post('/auth/two-factor/verify')
        .set('X-Forwarded-For', ip())
        .set('User-Agent', CHROME),
      device,
    ).send({ trustDevice: false, ...body });

  /** A school owner with two-step on (secret and 10 recovery codes stored as the API does). */
  async function account(opts: { twoFactor?: boolean } = {}): Promise<Account> {
    counter += 1;
    const code = `TFA${counter}`;
    const email = `owner${counter}@two.step`;
    const ids = await seedSchool(owner, { code, email, password: PASSWORD });
    const secret = generateTotpSecret();
    const recovery = generateRecoveryCodes();
    if (opts.twoFactor !== false) {
      await owner.user.update({
        where: { id: ids.userId },
        data: {
          totpSecretEnc: new Uint8Array(encryptSecret(infra.env.TOTP_ENCRYPTION_KEY, secret)),
          totpEnabledAt: new Date(),
        },
      });
      await owner.recoveryCode.createMany({
        data: recovery.map((c) => ({
          userId: ids.userId,
          codeHash: hashRecoveryCode(infra.env.AUTH_SECRET, normaliseRecoveryCode(c)),
        })),
      });
    }
    return { code, email, ...ids, secret, recovery };
  }

  /** The authenticator code for the current 30-second step plus `offset`. */
  const codeAt = (secret: string, offset = 0) =>
    generateSync({
      secret,
      strategy: 'hotp',
      counter: Math.floor(Date.now() / 30_000) + offset,
      digits: 6,
      algorithm: 'sha1',
    });

  /** A 6-digit code that matches no step in the accepted window. */
  function wrongCode(secret: string): string {
    const valid = new Set([codeAt(secret, -1), codeAt(secret, 0), codeAt(secret, 1)]);
    for (const candidate of ['000000', '111111', '222222', '333333']) {
      if (!valid.has(candidate)) return candidate;
    }
    throw new Error('unreachable');
  }

  /** Signs in with the password and returns the challenge and the device cookie set. */
  async function challengeFor(s: Account, device?: string) {
    const res = await passwordSignIn(s, { device });
    expect(res.status).toBe(202);
    const body = twoFactorChallengeSchema.parse(res.body);
    return { challenge: body.challenge, device: cookieOf(res, 'cl_device') as string, res };
  }

  const challengeKey = (challenge: string) => `auth:2fa:${sha256(challenge).toString('hex')}`;

  async function mailsTo(address: string): Promise<MailpitSummary[]> {
    const res = await fetch(
      `${infra.mailpitApiUrl}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    // Other notices (e.g. password changed) share the inbox; this suite counts new-device mails.
    const all = ((await res.json()) as { messages: MailpitSummary[] }).messages;
    return all.filter((mail) => mail.Subject === NEW_DEVICE_SUBJECT);
  }

  /** Waits until `count` new-device mails reached `address`, then checks no more follow. */
  async function expectNewDeviceMails(address: string, count: number) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && (await mailsTo(address)).length < count) await sleep(200);
    // Give a stray extra job time to land before counting.
    await sleep(750);
    const mails = await mailsTo(address);
    expect(mails).toHaveLength(count);
    for (const mail of mails) expect(mail.Subject).toBe(NEW_DEVICE_SUBJECT);
  }

  const sessionsOf = (userId: string) => owner.session.count({ where: { userId } });

  beforeAll(async () => {
    infra = await startTestInfra({ mailpit: true });
    app = await createApp({ ...infra.env, SIGN_IN_RATE_LIMIT_PER_15_MIN: 1000 }, { logger: false });
    await app.init();
    server = app.getHttpServer() as App;
    owner = ownerPrisma(infra.env);
    redis = app.get(RedisService);
    passwords = new PasswordService();
    expect(await redis.ping(5000)).toBe(true);
  }, 120_000);

  afterAll(async () => {
    await owner?.$disconnect();
    await app?.close();
    await infra?.stop();
  });

  it('password sign-in answers 202 with a challenge, no session and only a device cookie', async () => {
    const s = await account();
    const { challenge, device, res } = await challengeFor(s);
    const body = twoFactorChallengeSchema.parse(res.body);
    expect(body.twoFactorRequired).toBe(true);
    const expiresAt = new Date(body.expiresAt).getTime();
    expect(expiresAt - Date.now()).toBeGreaterThan(290_000);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(300_000);
    expect(cookieOf(res, 'cl_session')).toBeUndefined();
    expect(device).toMatch(/^[\w-]{43}$/);
    expect(await sessionsOf(s.userId)).toBe(0);
    expect(await owner.knownDevice.count({ where: { userId: s.userId } })).toBe(0);

    // Only the hash is the key; the value holds no secret and the TTL is 5 minutes.
    const ttl = await redis.client.ttl(challengeKey(challenge));
    expect(ttl).toBeGreaterThan(290);
    expect(ttl).toBeLessThanOrEqual(300);
    const stored: unknown = JSON.parse((await redis.client.get(challengeKey(challenge))) as string);
    expect(stored).toMatchObject({
      userId: s.userId,
      tenantId: s.tenantId,
      membershipId: s.membershipId,
      remember: true,
      method: 'PASSWORD',
      attemptsLeft: 5,
    });
    expect(JSON.stringify(stored)).not.toContain(challenge);
  });

  it('code sign-in answers 202 the same way', async () => {
    const s = await account();
    const code = '482913';
    await redis.client.set(
      `auth:otp:${s.tenantId}:${s.userId}`,
      JSON.stringify({
        hash: hmac(infra.env.AUTH_SECRET, `${s.tenantId}:${s.userId}:${code}`),
        attemptsLeft: 5,
      }),
      'EX',
      600,
    );
    const res = await request(server)
      .post('/auth/otp/verify')
      .set('X-Forwarded-For', ip())
      .send({ schoolCode: s.code, email: s.email, code, remember: false });
    expect(res.status).toBe(202);
    const body = twoFactorChallengeSchema.parse(res.body);
    expect(cookieOf(res, 'cl_session')).toBeUndefined();
    expect(cookieOf(res, 'cl_device')).toMatch(/^[\w-]{43}$/);
    expect(await sessionsOf(s.userId)).toBe(0);
    const stored: unknown = JSON.parse(
      (await redis.client.get(challengeKey(body.challenge))) as string,
    );
    expect(stored).toMatchObject({ method: 'EMAIL_CODE', remember: false });
  });

  it('verifies an app code: 200, cookie, events, fresh authenticated_at; the code is single use', async () => {
    const s = await account();
    const { challenge, device } = await challengeFor(s);
    const code = codeAt(s.secret);
    const ok = await verify({ challenge, code: `${code.slice(0, 3)} ${code.slice(3)}` }, device);
    expect(ok.status).toBe(200);
    const session = authSessionSchema.parse(ok.body);
    expect(session.user.id).toBe(s.userId);
    expect(cookieOf(ok, 'cl_session')).toMatch(/^[\w-]{43}$/);
    expect(cookieOf(ok, 'cl_device')).toBe(device);

    const row = await owner.session.findFirstOrThrow({ where: { userId: s.userId } });
    expect(Math.abs(row.authenticatedAt.getTime() - Date.now())).toBeLessThan(10_000);
    expect(row.remember).toBe(true);
    const events = await owner.authEvent.findMany({ where: { userId: s.userId } });
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'TWO_FACTOR_SUCCEEDED')).toHaveLength(1);
    expect(types.filter((t) => t === 'SIGN_IN_SUCCEEDED')).toHaveLength(1);
    expect(events.find((e) => e.type === 'SIGN_IN_SUCCEEDED')?.method).toBe('PASSWORD');
    expect(await redis.client.exists(challengeKey(challenge))).toBe(0);

    // The same code on a new challenge is a replay.
    const again = await challengeFor(s, device);
    const replay = await verify({ challenge: again.challenge, code }, device);
    expect(replay.status).toBe(401);
    expect(replay.body).toMatchObject({ type: 'two-factor-invalid', attemptsLeft: 4 });
    expect(await sessionsOf(s.userId)).toBe(1);
    await expectNewDeviceMails(s.email, 1);
  });

  it('two parallel verifies of one challenge with a valid code make exactly one session', async () => {
    const s = await account();
    const { challenge, device } = await challengeFor(s);
    const code = codeAt(s.secret);
    const results = await Promise.all([
      verify({ challenge, code }, device),
      verify({ challenge, code }, device),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
    expect(await sessionsOf(s.userId)).toBe(1);
    await expectNewDeviceMails(s.email, 1);
  });

  it('accepts a recovery code as typed, once', async () => {
    const s = await account();
    const { challenge, device } = await challengeFor(s);
    const typed = (s.recovery[0] as string).toLowerCase().replace('-', ' ');
    const ok = await verify({ challenge, recoveryCode: typed }, device);
    expect(ok.status).toBe(200);
    const used = await owner.authEvent.findMany({
      where: { userId: s.userId, type: 'RECOVERY_CODE_USED' },
    });
    expect(used).toHaveLength(1);
    expect(used[0]?.method).toBe('RECOVERY_CODE');
    expect(await owner.recoveryCode.count({ where: { userId: s.userId, usedAt: null } })).toBe(9);

    const again = await challengeFor(s, device);
    const second = await verify({ challenge: again.challenge, recoveryCode: typed }, device);
    expect(second.status).toBe(401);
    expect(second.body).toMatchObject({ type: 'two-factor-invalid' });
    expect(await sessionsOf(s.userId)).toBe(1);
    await expectNewDeviceMails(s.email, 1);
  });

  it('5 wrong codes use up the challenge; the 6th is told it expired', async () => {
    const s = await account();
    const { challenge, device } = await challengeFor(s);
    const wrong = wrongCode(s.secret);
    for (const left of [4, 3, 2, 1, 0]) {
      const res = await verify({ challenge, code: wrong }, device);
      expect(res.status).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body).toMatchObject({
        type: 'two-factor-invalid',
        title: "That code didn't work.",
        attemptsLeft: left,
      });
    }
    expect(await redis.client.exists(challengeKey(challenge))).toBe(0);
    const sixth = await verify({ challenge, code: codeAt(s.secret) }, device);
    expect(sixth.status).toBe(401);
    expect(sixth.body).toMatchObject({
      type: 'two-factor-expired',
      title: 'This sign-in has expired. Start again.',
    });
    expect(
      await owner.authEvent.count({ where: { userId: s.userId, type: 'TWO_FACTOR_FAILED' } }),
    ).toBe(5);
    expect(await sessionsOf(s.userId)).toBe(0);
    expect(await owner.knownDevice.count({ where: { userId: s.userId } })).toBe(0);
  });

  it('pauses the user after 5 wrong codes across challenges within 15 minutes', async () => {
    const s = await account();
    const wrong = wrongCode(s.secret);
    const a = await challengeFor(s);
    for (let i = 0; i < 3; i++) {
      expect((await verify({ challenge: a.challenge, code: wrong }, a.device)).status).toBe(401);
    }
    const b = await challengeFor(s, a.device);
    for (let i = 0; i < 2; i++) {
      expect((await verify({ challenge: b.challenge, code: wrong }, a.device)).status).toBe(401);
    }
    const sixth = await verify({ challenge: b.challenge, code: wrong }, a.device);
    expect(sixth.status).toBe(429);
    expect(sixth.body).toMatchObject({ type: 'two-factor-paused' });
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);

    // Even the right code waits out the pause.
    const c = await challengeFor(s, a.device);
    const right = await verify({ challenge: c.challenge, code: codeAt(s.secret) }, a.device);
    expect(right.status).toBe(429);
    expect(await sessionsOf(s.userId)).toBe(0);
  });

  it('refuses a challenge whose 5 minutes have lapsed', async () => {
    const s = await account();
    const { challenge, device } = await challengeFor(s);
    await redis.client.pexpire(challengeKey(challenge), 1);
    await sleep(20);
    const res = await verify({ challenge, code: codeAt(s.secret) }, device);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ type: 'two-factor-expired' });
    expect(await sessionsOf(s.userId)).toBe(0);
  });

  it('a trusted device skips the step, at every school of the user, until the password changes', async () => {
    const s = await account();
    const { challenge, device } = await challengeFor(s);
    const ok = await verify({ challenge, code: codeAt(s.secret), trustDevice: true }, device);
    expect(ok.status).toBe(200);
    const row = await owner.knownDevice.findFirstOrThrow({ where: { userId: s.userId } });
    expect(row.trustedUntil?.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(
      await owner.authEvent.count({ where: { userId: s.userId, type: 'DEVICE_TRUSTED' } }),
    ).toBe(1);

    const direct = await passwordSignIn(s, { device });
    expect(direct.status).toBe(200);
    expect(cookieOf(direct, 'cl_session')).toMatch(/^[\w-]{43}$/);

    // The same person at a second school, from the same browser.
    counter += 1;
    const other = await seedSchool(owner, {
      code: `TFB${counter}`,
      email: `other${counter}@two.step`,
      password: PASSWORD,
    });
    await addMember(owner, other.tenantId, s.userId);
    const second = await passwordSignIn({ code: `TFB${counter}`, email: s.email }, { device });
    expect(second.status).toBe(200);
    expect(authSessionSchema.parse(second.body).school.id).toBe(other.tenantId);

    // A new password ends the trust.
    const newPassword = 'another horse battery';
    await app.get(SessionService).changePassword(s.userId, {
      passwordHash: await passwords.hash(newPassword),
      reason: 'PASSWORD_CHANGED',
    });
    const after = await passwordSignIn(s, { device, password: newPassword });
    expect(after.status).toBe(202);
    await expectNewDeviceMails(s.email, 1);
  });

  it('a password reset while the challenge is pending refuses the verify, with no session', async () => {
    const s = await account();
    const { challenge, device } = await challengeFor(s);
    await app.get(SessionService).changePassword(s.userId, {
      passwordHash: await passwords.hash('brand new horse battery'),
      reason: 'PASSWORD_RESET',
    });
    const res = await verify({ challenge, code: codeAt(s.secret) }, device);
    expect(res.status).toBe(401);
    expect(await sessionsOf(s.userId)).toBe(0);
    expect(await owner.knownDevice.count({ where: { userId: s.userId } })).toBe(0);
  });

  it('two-step turned off while the challenge is pending refuses the verify as expired', async () => {
    const s = await account();
    const { challenge, device } = await challengeFor(s);
    await owner.user.update({
      where: { id: s.userId },
      data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null },
    });
    const res = await verify({ challenge, code: codeAt(s.secret) }, device);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ type: 'two-factor-expired' });
    expect(await sessionsOf(s.userId)).toBe(0);
  });

  it('emails once for a new device, never for a failed attempt, and not again for a known one', async () => {
    const s = await account();
    const first = await challengeFor(s);
    expect(
      (await verify({ challenge: first.challenge, code: codeAt(s.secret) }, first.device)).status,
    ).toBe(200);
    await expectNewDeviceMails(s.email, 1);

    const again = await challengeFor(s, first.device);
    expect(
      (await verify({ challenge: again.challenge, recoveryCode: s.recovery[0] }, first.device))
        .status,
    ).toBe(200);
    await expectNewDeviceMails(s.email, 1);

    // A different browser that never gets past the code step registers nothing.
    const stranger = await challengeFor(s);
    expect(stranger.device).not.toBe(first.device);
    expect(
      (await verify({ challenge: stranger.challenge, code: wrongCode(s.secret) }, stranger.device))
        .status,
    ).toBe(401);
    expect(await owner.knownDevice.count({ where: { userId: s.userId } })).toBe(1);
    await expectNewDeviceMails(s.email, 1);
  });

  it('a browser without the device cookie is asked every time and emailed every time', async () => {
    const s = await account();
    for (const [i, recoveryCode] of [s.recovery[0], s.recovery[1]].entries()) {
      const res = await passwordSignIn(s);
      expect(res.status).toBe(202);
      const { challenge } = twoFactorChallengeSchema.parse(res.body);
      const ok = await verify({ challenge, recoveryCode });
      expect(ok.status).toBe(200);
      await expectNewDeviceMails(s.email, i + 1);
    }
  });

  it('users without two-step sign in directly, with the device cookie and one new-device email', async () => {
    const s = await account({ twoFactor: false });
    const first = await passwordSignIn(s);
    expect(first.status).toBe(200);
    authSessionSchema.parse(first.body);
    const device = cookieOf(first, 'cl_device');
    expect(device).toMatch(/^[\w-]{43}$/);
    const second = await passwordSignIn(s, { device });
    expect(second.status).toBe(200);
    expect(cookieOf(second, 'cl_device')).toBe(device);
    await expectNewDeviceMails(s.email, 1);
  });

  // Keep last: it stops Redis for the rest of the suite.
  it('answers 503 while Redis is down', async () => {
    const s = await account();
    const { challenge, device } = await challengeFor(s);
    await sleep(500);
    await infra.redis.stop();
    const res = await verify({ challenge, code: codeAt(s.secret) }, device).timeout(15_000);
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(await sessionsOf(s.userId)).toBe(0);
  }, 30_000);
});
