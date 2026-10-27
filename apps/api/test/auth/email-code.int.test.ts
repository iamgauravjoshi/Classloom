import { authSessionSchema, problemDetailsSchema } from '@classloom/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { QueueProducer } from '../../src/core/queue/queue.module';
import { RedisService } from '../../src/core/redis/redis.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import { SignInPauseService } from '../../src/modules/auth/sign-in-pause.service';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';
import { seedSchool } from './helpers';

const WEB_ORIGIN = 'http://localhost:3000';
const INCORRECT = 'That code is incorrect or has expired.';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface MailpitSummary {
  ID: string;
  Subject: string;
}

describe('sign-in with an emailed code', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let redis: RedisService;
  let counter = 0;
  let ipCounter = 0;

  /** Every call gets its own client address, so the IP limits stay out of the way. */
  const ip = () => `203.0.113.${(ipCounter += 1)}`;

  const requestCode = (body: Record<string, unknown>) =>
    request(server).post('/auth/otp/request').set('X-Forwarded-For', ip()).send(body);

  const verify = (body: Record<string, unknown>) =>
    request(server)
      .post('/auth/otp/verify')
      .set('X-Forwarded-For', ip())
      .send({ remember: true, ...body });

  async function school() {
    counter += 1;
    const code = `OTP${counter}`;
    const email = `owner${counter}@otp.test`;
    const ids = await seedSchool(owner, { code, email, password: 'correct horse battery' });
    await owner.user.update({ where: { id: ids.userId }, data: { emailVerifiedAt: null } });
    return { code, email, ...ids };
  }

  async function mailsTo(address: string): Promise<MailpitSummary[]> {
    const res = await fetch(
      `${infra.mailpitApiUrl}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    return ((await res.json()) as { messages: MailpitSummary[] }).messages;
  }

  /** The code in the newest mail to `address`, once at least `count` mails have arrived. */
  async function emailedCode(address: string, count = 1): Promise<string> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const messages = await mailsTo(address);
      const newest = messages[0];
      if (messages.length >= count && newest) {
        const match = /^(\d{6}) is your Classloom sign-in code$/.exec(newest.Subject);
        if (match?.[1]) return match[1];
      }
      await sleep(200);
    }
    throw new Error(`No sign-in code arrived for ${address}`);
  }

  /** Pretends the last send was two minutes ago, so the 60-second rule does not apply. */
  const ageLastSend = (s: { tenantId: string; userId: string }) =>
    redis.client.hset(
      `auth:otp-sent:${s.tenantId}:${s.userId}`,
      'last',
      String(Date.now() - 120_000),
    );

  /** Sends a code and waits for it, so no email job is left when the next test starts. */
  async function sendCode(s: { code: string; email: string }, count = 1) {
    const res = await requestCode({ schoolCode: s.code, email: s.email });
    expect(res.status).toBe(202);
    return emailedCode(s.email, count);
  }

  const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

  beforeAll(async () => {
    infra = await startTestInfra({ mailpit: true });
    app = await createApp(
      {
        ...infra.env,
        SIGN_IN_RATE_LIMIT_PER_15_MIN: 1000,
        CODE_REQUEST_RATE_LIMIT_PER_HOUR: 1000,
      },
      { logger: false },
    );
    await app.init();
    server = app.getHttpServer() as App;
    owner = ownerPrisma(infra.env);
    redis = app.get(RedisService);
    expect(await redis.ping(5000)).toBe(true);
  });

  afterAll(async () => {
    await owner?.$disconnect();
    await app?.close();
    await infra?.stop();
  });

  it('emails a code, signs in with it once, verifies the address and records the events', async () => {
    const s = await school();
    const res = await requestCode({ schoolCode: s.code.toLowerCase(), email: s.email });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ maskedEmail: 'o***@otp.test' });
    const code = await emailedCode(s.email);
    expect(code).toMatch(/^\d{6}$/);
    expect(
      await owner.authEvent.count({ where: { userId: s.userId, type: 'CODE_REQUESTED' } }),
    ).toBe(1);

    const ok = await verify({ schoolCode: s.code, email: s.email.toUpperCase(), code });
    expect(ok.status).toBe(200);
    const session = authSessionSchema.parse(ok.body);
    expect(session.user.id).toBe(s.userId);
    expect(session.school.code).toBe(s.code);
    expect(ok.headers['set-cookie']?.[0]).toMatch(/^cl_session=[\w-]{43};.*HttpOnly/);

    const user = await owner.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(user.emailVerifiedAt).not.toBeNull();
    const events = await owner.authEvent.findMany({
      where: { userId: s.userId, type: 'SIGN_IN_SUCCEEDED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.method).toBe('EMAIL_CODE');

    const again = await verify({ schoolCode: s.code, email: s.email, code });
    expect(again.status).toBe(401);
    expect(again.headers['content-type']).toContain('application/problem+json');
    expect(problemDetailsSchema.parse(again.body).title).toBe(INCORRECT);
  });

  it('gives the same 202 and sends nothing for an unknown email, a revoked member or a suspended school', async () => {
    const revoked = await school();
    await owner.membership.update({
      where: { id: revoked.membershipId },
      data: { status: 'REVOKED' },
    });
    const suspended = await school();
    await owner.tenant.update({ where: { id: suspended.tenantId }, data: { status: 'SUSPENDED' } });
    const real = await school();

    const attempts = [
      { schoolCode: real.code, email: 'nobody@otp.test' },
      { schoolCode: revoked.code, email: revoked.email },
      { schoolCode: suspended.code, email: suspended.email },
      { schoolCode: 'NOSUCH', email: real.email },
    ];
    for (const attempt of attempts) {
      const res = await requestCode(attempt);
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ maskedEmail: `${attempt.email[0]}***@otp.test` });
    }
    await sleep(2000);
    for (const address of ['nobody@otp.test', revoked.email, suspended.email, real.email]) {
      expect(await mailsTo(address)).toHaveLength(0);
    }
    expect(await redis.client.keys(`auth:otp:${revoked.tenantId}:*`)).toHaveLength(0);
  });

  it('rejects an address that is not an email with 400', async () => {
    const res = await requestCode({ schoolCode: 'GISD', email: '9876543210' });
    expect(res.status).toBe(400);
  });

  it('drops a second request within 60 s; a later one replaces the code', async () => {
    const s = await school();
    const first = await sendCode(s);
    const second = await requestCode({ schoolCode: s.code, email: s.email });
    expect(second.status).toBe(202);
    await sleep(1500);
    expect(await mailsTo(s.email)).toHaveLength(1);

    await ageLastSend(s);
    const secondCode = await sendCode(s, 2);

    if (first !== secondCode) {
      const old = await verify({ schoolCode: s.code, email: s.email, code: first });
      expect(old.status).toBe(401);
    }
    const fresh = await verify({ schoolCode: s.code, email: s.email, code: secondCode });
    expect(fresh.status).toBe(200);
  });

  it('allows 5 sends an hour', async () => {
    const s = await school();
    for (let n = 1; n <= 5; n += 1) {
      if (n > 1) await ageLastSend(s);
      await sendCode(s, n);
    }
    await ageLastSend(s);
    await requestCode({ schoolCode: s.code, email: s.email });
    await sleep(1500);
    expect(await mailsTo(s.email)).toHaveLength(5);
  });

  it('stops a code after 5 wrong tries, even for the right code', async () => {
    const s = await school();
    const code = await sendCode(s);
    for (let n = 0; n < 5; n += 1) {
      const res = await verify({ schoolCode: s.code, email: s.email, code: wrongCode(code) });
      expect(res.status).toBe(401);
    }
    const right = await verify({ schoolCode: s.code, email: s.email, code });
    expect(right.status).toBe(401);
    expect(problemDetailsSchema.parse(right.body).title).toBe(INCORRECT);
  });

  it('cannot be guessed past 5 tries with parallel requests', async () => {
    const s = await school();
    const code = await sendCode(s);
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        verify({ schoolCode: s.code, email: s.email, code: wrongCode(code) }),
      ),
    );
    expect(results.every((r) => r.status === 401)).toBe(true);
    const right = await verify({ schoolCode: s.code, email: s.email, code });
    expect(right.status).toBe(401);
  });

  it('lets only one of two parallel correct verifications through', async () => {
    const s = await school();
    const code = await sendCode(s);
    const results = await Promise.all([
      verify({ schoolCode: s.code, email: s.email, code }),
      verify({ schoolCode: s.code, email: s.email, code }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('accepts a code typed with a space', async () => {
    const s = await school();
    const code = await sendCode(s);
    const res = await verify({
      schoolCode: s.code,
      email: s.email,
      code: `${code.slice(0, 3)} ${code.slice(3)}`,
    });
    expect(res.status).toBe(200);
  });

  it('gives 401 for a wrong school or an unknown email', async () => {
    const s = await school();
    const other = await school();
    const code = await sendCode(s);
    for (const body of [
      { schoolCode: other.code, email: s.email, code },
      { schoolCode: s.code, email: 'nobody@otp.test', code },
      { schoolCode: 'NOSUCH', email: s.email, code },
    ]) {
      const res = await verify(body);
      expect(res.status).toBe(401);
      expect(problemDetailsSchema.parse(res.body).title).toBe(INCORRECT);
    }
  });

  it('never puts the code in the send-code job', async () => {
    const s = await school();
    const added = vi.spyOn(app.get(QueueProducer), 'add');
    const code = await sendCode(s);
    const authJobs = added.mock.calls.filter(([queue]) => queue === 'auth');
    added.mockRestore();
    expect(authJobs).toHaveLength(1);
    expect(authJobs[0]?.[1]).toBe('send-code');
    expect(authJobs[0]?.[2]).toEqual({ schoolCode: s.code, email: s.email });

    // Nothing the auth queue keeps in Redis (waiting, completed or failed) holds the code.
    for (const key of await redis.client.keys('bull:auth:*')) {
      if ((await redis.client.type(key)) !== 'hash') continue;
      const job = JSON.stringify(await redis.client.hgetall(key));
      if (job.includes(s.email)) expect(job).not.toContain(code);
    }
    // The code itself is stored only as an HMAC.
    expect(await redis.client.get(`auth:otp:${s.tenantId}:${s.userId}`)).not.toContain(code);
  });

  it('signs in by code while the password is paused, and the pause stays', async () => {
    const s = await school();
    const pauses = app.get(SignInPauseService);
    for (let n = 1; n <= 5; n += 1) {
      const { attempt } = await pauses.reserveAttempt(s.tenantId, s.email);
      await pauses.recordFailure(s.tenantId, s.email, attempt);
    }
    expect(await pauses.isPaused(s.tenantId, s.email)).not.toBeNull();

    const code = await sendCode(s);
    const res = await verify({ schoolCode: s.code, email: s.email, code });
    expect(res.status).toBe(200);
    expect(await pauses.isPaused(s.tenantId, s.email)).not.toBeNull();
  });

  it('replaces the session the request carried', async () => {
    const s = await school();
    const first = await verify({ schoolCode: s.code, email: s.email, code: await sendCode(s) });
    expect(first.status).toBe(200);
    const cookie = (first.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
    await ageLastSend(s);
    const code = await sendCode(s, 2);
    const second = await request(server)
      .post('/auth/otp/verify')
      .set('X-Forwarded-For', ip())
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', cookie)
      .send({ schoolCode: s.code, email: s.email, code, remember: false });
    expect(second.status).toBe(200);
    const sessions = await owner.session.findMany({ where: { userId: s.userId } });
    expect(sessions.filter((x) => x.revokedReason === 'REPLACED')).toHaveLength(1);
  });

  // Keep last: it stops Redis.
  it('fails fast with 503 problem+json when Redis is down', async () => {
    const s = await school();
    await infra.redis.stop();
    const started = Date.now();
    const res = await requestCode({ schoolCode: s.code, email: s.email }).timeout(10_000);
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
