import {
  authSessionSchema,
  recoveryCodesSchema,
  twoFactorChallengeSchema,
  twoFactorSetupSchema,
  twoFactorStatusSchema,
} from '@classloom/contracts';
import type { INestApplication } from '@nestjs/common';
import { generateSync } from 'otplib';
import request from 'supertest';
import type { App } from 'supertest/types';

import { RedisService } from '../../src/core/redis/redis.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import { randomToken, sha256 } from '../../src/modules/auth/crypto';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normaliseRecoveryCode,
} from '../../src/modules/auth/recovery-codes';
import { decryptSecret, encryptSecret } from '../../src/modules/auth/secret-box';
import { SessionService } from '../../src/modules/auth/session.service';
import { generateTotpSecret } from '../../src/modules/auth/totp';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';
import { seedSchool } from './helpers';

const WEB_ORIGIN = 'http://localhost:3000';
const COOKIE = 'cl_session';
const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'purple elephant dances';
const MINUTE = 60_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SUBJECT = {
  enabled: 'Two-step sign-in was turned on',
  disabled: 'Two-step sign-in was turned off',
  codes: 'New recovery codes were created',
  password: 'Your Classloom password was changed',
};

interface MailpitSummary {
  ID: string;
  Subject: string;
}

interface Problem {
  type?: string;
  errors?: { path: string }[];
}

describe('turning two-step on and off', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let redis: RedisService;
  let sessions: SessionService;
  let counter = 0;
  let ipCounter = 0;

  const ip = () => `198.51.100.${((ipCounter += 1) % 250) + 1}`;

  async function account(
    opts: { twoFactor?: boolean; password?: string | null; authenticatedMinutesAgo?: number } = {},
  ) {
    counter += 1;
    const code = `TFS${counter}`;
    const email = `owner${counter}@settings.test`;
    const password = opts.password === null ? undefined : (opts.password ?? PASSWORD);
    const ids = await seedSchool(owner, { code, email, password });
    const { token, session } = await sessions.create({ ...ids, remember: true });
    if (opts.authenticatedMinutesAgo !== undefined) {
      await owner.session.update({
        where: { id: session.id },
        data: { authenticatedAt: new Date(Date.now() - opts.authenticatedMinutesAgo * MINUTE) },
      });
    }
    const secret = generateTotpSecret();
    const recovery = generateRecoveryCodes();
    if (opts.twoFactor) {
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
    return {
      code,
      email,
      ...ids,
      sessionId: session.id,
      cookie: `${COOKIE}=${token}`,
      secret,
      recovery,
    };
  }
  type Account = Awaited<ReturnType<typeof account>>;

  const codeAt = (secret: string, offset = 0) =>
    generateSync({
      secret,
      strategy: 'hotp',
      counter: Math.floor(Date.now() / 30_000) + offset,
      digits: 6,
      algorithm: 'sha1',
    });

  function wrongCode(secret: string): string {
    const valid = new Set([codeAt(secret, -1), codeAt(secret, 0), codeAt(secret, 1)]);
    for (const candidate of ['000000', '111111', '222222', '333333']) {
      if (!valid.has(candidate)) return candidate;
    }
    throw new Error('unreachable');
  }

  /** Test-only: forget the last accepted step so the next code of this window can be used again. */
  const forgetStep = (userId: string) =>
    owner.user.update({ where: { id: userId }, data: { totpLastStep: null } });

  const get = (a: Account) => request(server).get('/me/two-factor').set('Cookie', a.cookie);
  const post = (a: Account, path: string, body?: object) =>
    request(server)
      .post(`/me/two-factor/${path}`)
      .set('Cookie', a.cookie)
      .set('Origin', WEB_ORIGIN)
      .send(body ?? {});

  const pendingKey = (userId: string) => `auth:2fa-setup:${userId}`;

  async function mailsTo(address: string): Promise<MailpitSummary[]> {
    const res = await fetch(
      `${infra.mailpitApiUrl}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    return ((await res.json()) as { messages: MailpitSummary[] }).messages;
  }

  /** Waits for `count` mails with `subject`, then checks that no more follow. */
  async function expectMails(address: string, subject: string, count: number) {
    const matching = async () => (await mailsTo(address)).filter((m) => m.Subject === subject);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && (await matching()).length < count) await sleep(200);
    await sleep(750);
    expect(await matching()).toHaveLength(count);
  }

  /** Runs setup and enable with a fresh code; returns the 10 recovery codes. */
  async function turnOn(a: Account): Promise<string[]> {
    const setup = twoFactorSetupSchema.parse((await post(a, 'setup')).body);
    const res = await post(a, 'enable', { code: codeAt(setup.secret) });
    expect(res.status).toBe(200);
    a.secret = setup.secret;
    return recoveryCodesSchema.parse(res.body).recoveryCodes;
  }

  beforeAll(async () => {
    infra = await startTestInfra({ mailpit: true });
    app = await createApp(infra.env, { logger: false });
    await app.init();
    server = app.getHttpServer() as App;
    owner = ownerPrisma(infra.env);
    redis = app.get(RedisService);
    sessions = app.get(SessionService, { strict: false });
    expect(await redis.ping(5000)).toBe(true);
  }, 120_000);

  afterAll(async () => {
    await owner?.$disconnect();
    await app?.close();
    await infra?.stop();
  });

  describe('status', () => {
    it('is 401 signed out', async () => {
      expect((await request(server).get('/me/two-factor')).status).toBe(401);
    });

    it('reports off, then on with the date and the recovery codes left', async () => {
      const a = await account();
      expect(twoFactorStatusSchema.parse((await get(a)).body)).toEqual({
        enabled: false,
        enabledAt: null,
        recoveryCodesLeft: 0,
      });
      await turnOn(a);
      const on = twoFactorStatusSchema.parse((await get(a)).body);
      expect(on.enabled).toBe(true);
      expect(on.recoveryCodesLeft).toBe(10);
      expect(Math.abs(new Date(on.enabledAt as string).getTime() - Date.now())).toBeLessThan(
        10_000,
      );
    });

    it('shows the recovery codes left going down as they are used to sign in', async () => {
      const a = await account({ twoFactor: true });
      for (const [i, used] of a.recovery.slice(0, 2).entries()) {
        const first = await request(server)
          .post('/auth/sign-in/password')
          .set('X-Forwarded-For', ip())
          .send({ schoolCode: a.code, identifier: a.email, password: PASSWORD, remember: false });
        expect(first.status).toBe(202);
        const { challenge } = twoFactorChallengeSchema.parse(first.body);
        const ok = await request(server)
          .post('/auth/two-factor/verify')
          .set('X-Forwarded-For', ip())
          .send({ challenge, recoveryCode: used, trustDevice: false });
        expect(ok.status).toBe(200);
        authSessionSchema.parse(ok.body);
        expect(twoFactorStatusSchema.parse((await get(a)).body).recoveryCodesLeft).toBe(9 - i);
      }
    });
  });

  describe('setup', () => {
    it('needs a sign-in from the last 10 minutes', async () => {
      const a = await account({ authenticatedMinutesAgo: 11 });
      const res = await post(a, 'setup');
      expect(res.status).toBe(403);
      expect((res.body as Problem).type).toMatch(/recent-sign-in-required$/);
      expect(await redis.client.exists(pendingKey(a.userId))).toBe(0);
    });

    it('returns a secret and an otpauth URL, keeping the secret encrypted for 10 minutes', async () => {
      const a = await account();
      const res = await post(a, 'setup');
      expect(res.status).toBe(200);
      const setup = twoFactorSetupSchema.parse(res.body);
      expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(setup.otpauthUrl).toBe(
        `otpauth://totp/Classloom:${encodeURIComponent(a.email)}?secret=${setup.secret}&issuer=Classloom&digits=6&period=30&algorithm=SHA1`,
      );

      const stored = (await redis.client.get(pendingKey(a.userId))) as string;
      expect(stored).not.toContain(setup.secret);
      expect(decryptSecret(infra.env.TOTP_ENCRYPTION_KEY, Buffer.from(stored, 'base64'))).toBe(
        setup.secret,
      );
      const ttl = await redis.client.ttl(pendingKey(a.userId));
      expect(ttl).toBeGreaterThan(590);
      expect(ttl).toBeLessThanOrEqual(600);
      const row = await owner.user.findUniqueOrThrow({ where: { id: a.userId } });
      expect(row.totpSecretEnc).toBeNull();
    });

    it('is 409 while two-step is on', async () => {
      const a = await account({ twoFactor: true });
      expect((await post(a, 'setup')).status).toBe(409);
    });

    it('needs the Origin header like any cookie-carrying POST', async () => {
      const a = await account();
      const res = await request(server).post('/me/two-factor/setup').set('Cookie', a.cookie);
      expect(res.status).toBe(403);
    });
  });

  describe('enable', () => {
    it('is 400 for a wrong code and keeps the setup open', async () => {
      const a = await account();
      const setup = twoFactorSetupSchema.parse((await post(a, 'setup')).body);
      const res = await post(a, 'enable', { code: wrongCode(setup.secret) });
      expect(res.status).toBe(400);
      expect((res.body as Problem).errors?.map((e) => e.path)).toEqual(['code']);
      expect(await redis.client.exists(pendingKey(a.userId))).toBe(1);
      const row = await owner.user.findUniqueOrThrow({ where: { id: a.userId } });
      expect(row.totpEnabledAt).toBeNull();
    });

    it('is 410 once the setup has expired, or never started', async () => {
      const a = await account();
      const setup = twoFactorSetupSchema.parse((await post(a, 'setup')).body);
      await redis.client.del(pendingKey(a.userId));
      const res = await post(a, 'enable', { code: codeAt(setup.secret) });
      expect(res.status).toBe(410);
      expect((await post(await account(), 'enable', { code: '123456' })).status).toBe(410);
    });

    it('needs a recent sign-in', async () => {
      const a = await account({ authenticatedMinutesAgo: 11 });
      const res = await post(a, 'enable', { code: '123456' });
      expect(res.status).toBe(403);
    });

    it('turns two-step on: 10 codes, encrypted secret, replay guard, event and email', async () => {
      const a = await account();
      const setup = twoFactorSetupSchema.parse((await post(a, 'setup')).body);
      const code = codeAt(setup.secret);
      const res = await post(a, 'enable', { code: `${code.slice(0, 3)} ${code.slice(3)}` });
      expect(res.status).toBe(200);
      const { recoveryCodes } = recoveryCodesSchema.parse(res.body);
      expect(new Set(recoveryCodes).size).toBe(10);
      for (const c of recoveryCodes)
        expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);

      const row = await owner.user.findUniqueOrThrow({ where: { id: a.userId } });
      expect(row.totpEnabledAt).not.toBeNull();
      const box = Buffer.from(row.totpSecretEnc as Uint8Array);
      expect(box.toString('utf8')).not.toContain(setup.secret);
      expect(box.includes(Buffer.from(setup.secret))).toBe(false);
      expect(decryptSecret(infra.env.TOTP_ENCRYPTION_KEY, box)).toBe(setup.secret);
      // The accepted step is recorded, so the code just used cannot be replayed at sign-in.
      const step = BigInt(Math.floor(Date.now() / 30_000));
      expect(row.totpLastStep).not.toBeNull();
      expect(Math.abs(Number((row.totpLastStep as bigint) - step))).toBeLessThanOrEqual(1);

      const hashes = (await owner.recoveryCode.findMany({ where: { userId: a.userId } })).map(
        (r) => r.codeHash,
      );
      expect(hashes.sort()).toEqual(
        recoveryCodes
          .map((c) => hashRecoveryCode(infra.env.AUTH_SECRET, normaliseRecoveryCode(c)))
          .sort(),
      );
      expect(await redis.client.exists(pendingKey(a.userId))).toBe(0);

      const events = await owner.authEvent.findMany({
        where: { userId: a.userId, type: 'TWO_FACTOR_ENABLED' },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.sessionId).toBe(a.sessionId);
      await expectMails(a.email, SUBJECT.enabled, 1);

      // The code that turned it on is refused at the next sign-in.
      const first = await request(server)
        .post('/auth/sign-in/password')
        .set('X-Forwarded-For', ip())
        .send({ schoolCode: a.code, identifier: a.email, password: PASSWORD, remember: false });
      expect(first.status).toBe(202);
      const { challenge } = twoFactorChallengeSchema.parse(first.body);
      const replay = await request(server)
        .post('/auth/two-factor/verify')
        .set('X-Forwarded-For', ip())
        .send({ challenge, code, trustDevice: false });
      expect(replay.status).toBe(401);
    });

    it('cannot be run twice with the same setup', async () => {
      const a = await account();
      const setup = twoFactorSetupSchema.parse((await post(a, 'setup')).body);
      const code = codeAt(setup.secret);
      const results = await Promise.all([post(a, 'enable', { code }), post(a, 'enable', { code })]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await owner.recoveryCode.count({ where: { userId: a.userId } })).toBe(10);
    });
  });

  describe('new recovery codes', () => {
    it('with an app code: 10 new codes, the old ones stop working, email', async () => {
      const a = await account();
      const oldCodes = await turnOn(a);
      await forgetStep(a.userId);
      const res = await post(a, 'recovery-codes', { code: codeAt(a.secret) });
      expect(res.status).toBe(200);
      const fresh = recoveryCodesSchema.parse(res.body).recoveryCodes;
      expect(fresh.filter((c) => oldCodes.includes(c))).toEqual([]);
      expect(await owner.recoveryCode.count({ where: { userId: a.userId } })).toBe(10);

      // An old code no longer signs in; a new one does.
      const signIn = async (recoveryCode: string) => {
        const first = await request(server)
          .post('/auth/sign-in/password')
          .set('X-Forwarded-For', ip())
          .send({ schoolCode: a.code, identifier: a.email, password: PASSWORD, remember: false });
        const { challenge } = twoFactorChallengeSchema.parse(first.body);
        return request(server)
          .post('/auth/two-factor/verify')
          .set('X-Forwarded-For', ip())
          .send({ challenge, recoveryCode, trustDevice: false });
      };
      expect((await signIn(oldCodes[0] as string)).status).toBe(401);
      expect((await signIn(fresh[0] as string)).status).toBe(200);

      const events = await owner.authEvent.count({
        where: { userId: a.userId, type: 'RECOVERY_CODES_REGENERATED' },
      });
      expect(events).toBe(1);
      await expectMails(a.email, SUBJECT.codes, 1);
    });

    it('is 400 for a wrong code (old codes stay valid) and 409 when two-step is off', async () => {
      const a = await account({ twoFactor: true });
      const res = await post(a, 'recovery-codes', { code: wrongCode(a.secret) });
      expect(res.status).toBe(400);
      expect(await owner.recoveryCode.count({ where: { userId: a.userId } })).toBe(10);
      expect((await post(await account(), 'recovery-codes', { code: '123456' })).status).toBe(409);
    });

    it('needs a recent sign-in', async () => {
      const a = await account({ twoFactor: true, authenticatedMinutesAgo: 11 });
      const res = await post(a, 'recovery-codes', { code: codeAt(a.secret) });
      expect(res.status).toBe(403);
    });
  });

  describe('disable', () => {
    it('with a recovery code: 204, secret, codes and device trust cleared, event and email', async () => {
      const a = await account({ twoFactor: true });
      await owner.knownDevice.create({
        data: {
          userId: a.userId,
          deviceHash: new Uint8Array(sha256('some-device')),
          label: 'Chrome on Windows',
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          trustedUntil: new Date(Date.now() + 86_400_000),
        },
      });
      const res = await post(a, 'disable', { recoveryCode: a.recovery[3] });
      expect(res.status).toBe(204);

      const row = await owner.user.findUniqueOrThrow({ where: { id: a.userId } });
      expect(row).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null });
      expect(await owner.recoveryCode.count({ where: { userId: a.userId } })).toBe(0);
      expect(
        await owner.knownDevice.count({ where: { userId: a.userId, trustedUntil: { not: null } } }),
      ).toBe(0);
      expect(await owner.knownDevice.count({ where: { userId: a.userId } })).toBe(1);
      expect(
        await owner.authEvent.count({ where: { userId: a.userId, type: 'TWO_FACTOR_DISABLED' } }),
      ).toBe(1);
      expect(twoFactorStatusSchema.parse((await get(a)).body).enabled).toBe(false);
      await expectMails(a.email, SUBJECT.disabled, 1);
    });

    it('with an app code: 204', async () => {
      const a = await account({ twoFactor: true });
      const res = await post(a, 'disable', { code: codeAt(a.secret) });
      expect(res.status).toBe(204);
      await expectMails(a.email, SUBJECT.disabled, 1);
    });

    it('is 400 for a wrong code and keeps everything on; the body must carry exactly one code', async () => {
      const a = await account({ twoFactor: true });
      const wrong = await post(a, 'disable', { code: wrongCode(a.secret) });
      expect(wrong.status).toBe(400);
      const wrongRecovery = await post(a, 'disable', { recoveryCode: 'ZZZZZ-ZZZZZ' });
      expect(wrongRecovery.status).toBe(400);
      expect((wrongRecovery.body as Problem).errors?.map((e) => e.path)).toEqual(['recoveryCode']);
      expect((await post(a, 'disable', {})).status).toBe(400);
      const row = await owner.user.findUniqueOrThrow({ where: { id: a.userId } });
      expect(row.totpEnabledAt).not.toBeNull();
    });

    it('is 409 when two-step is already off and 403 without a recent sign-in', async () => {
      expect((await post(await account(), 'disable', { code: '123456' })).status).toBe(409);
      const old = await account({ twoFactor: true, authenticatedMinutesAgo: 11 });
      expect((await post(old, 'disable', { code: codeAt(old.secret) })).status).toBe(403);
    });
  });

  describe('wrong-code limit', () => {
    it('counts wrong codes across the endpoints: the 6th is 429 even with a right code', async () => {
      const a = await account({ twoFactor: true });
      const wrong = wrongCode(a.secret);
      for (let i = 0; i < 3; i += 1) {
        expect((await post(a, 'disable', { code: wrong })).status).toBe(400);
      }
      for (let i = 0; i < 2; i += 1) {
        expect((await post(a, 'recovery-codes', { code: wrong })).status).toBe(400);
      }
      const limited = await post(a, 'recovery-codes', { code: codeAt(a.secret) });
      expect(limited.status).toBe(429);
      expect((limited.body as Problem).type).toMatch(/two-factor-paused$/);
      expect((await post(a, 'disable', { code: codeAt(a.secret) })).status).toBe(429);
      const row = await owner.user.findUniqueOrThrow({ where: { id: a.userId } });
      expect(row.totpEnabledAt).not.toBeNull();
    });

    it('counts wrong codes at enable too', async () => {
      const a = await account();
      const setup = twoFactorSetupSchema.parse((await post(a, 'setup')).body);
      for (let i = 0; i < 5; i += 1) {
        expect((await post(a, 'enable', { code: wrongCode(setup.secret) })).status).toBe(400);
      }
      expect((await post(a, 'enable', { code: codeAt(setup.secret) })).status).toBe(429);
    });
  });

  describe('password-changed email', () => {
    it('is sent once when a first password is set', async () => {
      const a = await account({ password: null });
      const res = await request(server)
        .put('/me/password')
        .set('Cookie', a.cookie)
        .set('Origin', WEB_ORIGIN)
        .send({ newPassword: NEW_PASSWORD });
      expect(res.status).toBe(204);
      await expectMails(a.email, SUBJECT.password, 1);
    });

    it('is sent once when the password is changed, and clears device trust', async () => {
      const a = await account();
      await owner.knownDevice.create({
        data: {
          userId: a.userId,
          deviceHash: new Uint8Array(sha256('trusted-device')),
          label: 'Chrome on Windows',
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          trustedUntil: new Date(Date.now() + 86_400_000),
        },
      });
      const res = await request(server)
        .put('/me/password')
        .set('Cookie', a.cookie)
        .set('Origin', WEB_ORIGIN)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
      expect(res.status).toBe(204);
      expect(
        await owner.knownDevice.count({ where: { userId: a.userId, trustedUntil: { not: null } } }),
      ).toBe(0);
      await expectMails(a.email, SUBJECT.password, 1);
      const [mail] = (await mailsTo(a.email)).filter((m) => m.Subject === SUBJECT.password);
      const body = (await (
        await fetch(`${infra.mailpitApiUrl}/api/v1/message/${(mail as MailpitSummary).ID}`)
      ).json()) as { Text: string };
      expect(body.Text).toContain(`${WEB_ORIGIN}/en/forgot-password`);
    });

    it('is sent once when the password is reset', async () => {
      const a = await account();
      const token = randomToken();
      await redis.client.set(`auth:reset:${sha256(token).toString('hex')}`, a.userId, 'EX', 1800);
      const res = await request(server)
        .post('/auth/password/reset')
        .send({ token, newPassword: NEW_PASSWORD });
      expect(res.status).toBe(204);
      await expectMails(a.email, SUBJECT.password, 1);
    });
  });
});
