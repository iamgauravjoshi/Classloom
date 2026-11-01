import { createHash } from 'node:crypto';

import { problemDetailsSchema } from '@classloom/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { QueueProducer } from '../../src/core/queue/queue.module';
import { RedisService } from '../../src/core/redis/redis.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';
import { seedSchool } from './helpers';

const WEB_ORIGIN = 'http://localhost:3000';
const OLD_PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'purple elephant dances';
const GONE = 'This reset link has expired or was already used.';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface MailpitSummary {
  ID: string;
  Subject: string;
}

describe('forgot and reset password', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let redis: RedisService;
  let counter = 0;
  let ipCounter = 0;

  const ip = () => `192.0.2.${(ipCounter += 1)}`;

  const forgot = (identifier: string) =>
    request(server).post('/auth/password/forgot').set('X-Forwarded-For', ip()).send({ identifier });

  const reset = (token: string, newPassword: string) =>
    request(server).post('/auth/password/reset').send({ token, newPassword });

  const signIn = (s: { code: string }, identifier: string, password: string) =>
    request(server)
      .post('/auth/sign-in/password')
      .set('X-Forwarded-For', ip())
      .send({ schoolCode: s.code, identifier, password, remember: true });

  async function school(extra: { mobile?: string } = {}) {
    counter += 1;
    const code = `RST${counter}`;
    const email = `owner${counter}@reset.test`;
    const ids = await seedSchool(owner, { code, email, password: OLD_PASSWORD, ...extra });
    return { code, email, ...ids };
  }

  /** Reset mails only: a sign-in in a test also sends a new-device email to the address. */
  async function mailsTo(address: string): Promise<MailpitSummary[]> {
    const res = await fetch(
      `${infra.mailpitApiUrl}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    return ((await res.json()) as { messages: MailpitSummary[] }).messages.filter(
      (m) => m.Subject === 'Reset your Classloom password',
    );
  }

  /** The reset links in every mail to `address`, once at least `count` have arrived (newest first). */
  async function resetLinks(address: string, count = 1): Promise<string[]> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const messages = await mailsTo(address);
      if (messages.length >= count) {
        const links: string[] = [];
        for (const message of messages) {
          const res = await fetch(`${infra.mailpitApiUrl}/api/v1/message/${message.ID}`);
          const body = (await res.json()) as { Text: string; Subject: string };
          expect(body.Subject).toBe('Reset your Classloom password');
          const match = /(http\S+\/en\/reset-password\?token=[\w-]+)/.exec(body.Text);
          if (match?.[1]) links.push(match[1]);
        }
        return links;
      }
      await sleep(200);
    }
    throw new Error(`No reset email arrived for ${address}`);
  }

  const tokenOf = (link: string) => new URL(link).searchParams.get('token') ?? '';

  /** Requests a link and waits for it, so no email job is left when the next test starts. */
  async function requestLink(identifier: string, address: string, count = 1) {
    const res = await forgot(identifier);
    expect(res.status).toBe(202);
    const links = await resetLinks(address, count);
    return links[0] ?? '';
  }

  beforeAll(async () => {
    infra = await startTestInfra({ mailpit: true });
    app = await createApp(
      {
        ...infra.env,
        SIGN_IN_RATE_LIMIT_PER_15_MIN: 1000,
        PASSWORD_RESET_RATE_LIMIT_PER_HOUR: 1000,
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

  it('emails a link to the account email, for an email and for a mobile number', async () => {
    const s = await school({ mobile: '+919876500001' });
    const link = await requestLink(s.email.toUpperCase(), s.email);
    expect(link.startsWith(`${WEB_ORIGIN}/en/reset-password?token=`)).toBe(true);
    expect(tokenOf(link)).toMatch(/^[\w-]{43}$/);

    const byMobile = await forgot('98765 00001');
    expect(byMobile.status).toBe(202);
    const links = await resetLinks(s.email, 2);
    expect(links).toHaveLength(2);
    expect(
      await owner.authEvent.count({
        where: { userId: s.userId, type: 'PASSWORD_RESET_REQUESTED' },
      }),
    ).toBe(2);
  });

  it('does not keep the typed identifier in a finished send-reset job', async () => {
    const s = await school();
    const added = vi.spyOn(app.get(QueueProducer), 'add');
    await requestLink(s.email, s.email);
    const resetJobs = added.mock.calls.filter(([, name]) => name === 'send-reset');
    added.mockRestore();
    expect(resetJobs).toHaveLength(1);
    expect(resetJobs[0]?.[3]).toMatchObject({
      removeOnComplete: true,
      removeOnFail: { age: 3600 },
    });
  });

  it('keeps only the hash of the token in Redis, in the key', async () => {
    const s = await school();
    const token = tokenOf(await requestLink(s.email, s.email));
    const hash = createHash('sha256').update(token).digest('hex');

    const keys = await redis.client.keys('auth:reset*');
    expect(keys).toContain(`auth:reset:${hash}`);
    for (const key of keys) {
      expect(key).not.toContain(token);
      expect(await redis.client.get(key)).not.toContain(token);
    }
    expect(await redis.client.get(`auth:reset:${hash}`)).toBe(s.userId);
    const ttl = await redis.client.ttl(`auth:reset:${hash}`);
    expect(ttl).toBeGreaterThan(1700);
    expect(ttl).toBeLessThanOrEqual(1800);
  });

  it('gives the same 202 and sends nothing for an unknown identifier or a user with no active school', async () => {
    const suspended = await school();
    await owner.tenant.update({ where: { id: suspended.tenantId }, data: { status: 'SUSPENDED' } });
    const revoked = await school({ mobile: '+919876500002' });
    await owner.membership.update({
      where: { id: revoked.membershipId },
      data: { status: 'REVOKED' },
    });

    for (const identifier of [
      'nobody@reset.test',
      '9876599999',
      suspended.email,
      revoked.email,
      '9876500002',
    ]) {
      const res = await forgot(identifier);
      expect(res.status).toBe(202);
    }
    await sleep(2000);
    for (const address of ['nobody@reset.test', suspended.email, revoked.email]) {
      expect(await mailsTo(address)).toHaveLength(0);
    }
    for (const u of [suspended, revoked]) {
      expect(await redis.client.exists(`auth:reset-user:${u.userId}`)).toBe(0);
    }
  });

  it('sends a link when only one of the user schools is active', async () => {
    const dead = await school();
    await owner.tenant.update({ where: { id: dead.tenantId }, data: { status: 'SUSPENDED' } });
    const live = await school();
    await owner.membership.create({
      data: { tenantId: live.tenantId, userId: dead.userId, role: 'OWNER' },
    });
    expect(await requestLink(dead.email, dead.email)).toContain('/en/reset-password?token=');
  });

  it('rejects an identifier that is neither an email nor a mobile number with 400', async () => {
    expect((await forgot('nope')).status).toBe(400);
  });

  it('sends at most 3 links an hour to a user', async () => {
    const s = await school();
    for (let i = 1; i <= 3; i += 1) await requestLink(s.email, s.email, i);
    const fourth = await forgot(s.email);
    expect(fourth.status).toBe(202);
    await sleep(2000);
    expect(await mailsTo(s.email)).toHaveLength(3);
  });

  it('lets only the newest link work', async () => {
    const s = await school();
    const first = await requestLink(s.email, s.email);
    const second = await requestLink(s.email, s.email, 2);
    expect(second).not.toBe(first);

    const stale = await reset(tokenOf(first), NEW_PASSWORD);
    expect(stale.status).toBe(410);
    expect(await reset(tokenOf(second), NEW_PASSWORD)).toHaveProperty('status', 204);
  });

  it('lets exactly one of several parallel requests leave a working link', async () => {
    const s = await school();
    await Promise.all([forgot(s.email), forgot(s.email), forgot(s.email)]);
    const links = await resetLinks(s.email, 3);
    expect(links).toHaveLength(3);

    const statuses: number[] = [];
    for (const link of links) statuses.push((await reset(tokenOf(link), NEW_PASSWORD)).status);
    expect(statuses.filter((status) => status === 204)).toHaveLength(1);
    expect(statuses.filter((status) => status === 410)).toHaveLength(2);
  });

  it('resets the password, revokes every session, verifies the email and records the event', async () => {
    const s = await school();
    await owner.user.update({ where: { id: s.userId }, data: { emailVerifiedAt: null } });
    for (let i = 0; i < 2; i += 1) {
      expect((await signIn(s, s.email, OLD_PASSWORD)).status).toBe(200);
    }
    const link = await requestLink(s.email, s.email);

    const res = await reset(tokenOf(link), NEW_PASSWORD);
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie']).toBeUndefined();

    const sessions = await owner.session.findMany({ where: { userId: s.userId } });
    expect(sessions).toHaveLength(2);
    for (const session of sessions) {
      expect(session.revokedAt).not.toBeNull();
      expect(session.revokedReason).toBe('PASSWORD_RESET');
    }
    const user = await owner.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.passwordChangedAt).not.toBeNull();
    const events = await owner.authEvent.findMany({
      where: { userId: s.userId, type: 'PASSWORD_RESET' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.method).toBe('RESET_LINK');

    expect((await signIn(s, s.email, OLD_PASSWORD)).status).toBe(401);
    expect((await signIn(s, s.email, NEW_PASSWORD)).status).toBe(200);

    const again = await reset(tokenOf(link), 'another long passphrase');
    expect(again.status).toBe(410);
    expect(again.headers['content-type']).toContain('application/problem+json');
    expect(problemDetailsSchema.parse(again.body).title).toBe(GONE);
  });

  it('gives the same 410 for an unknown token', async () => {
    const res = await reset('A'.repeat(43), NEW_PASSWORD);
    expect(res.status).toBe(410);
    expect(problemDetailsSchema.parse(res.body).title).toBe(GONE);
  });

  it('rejects a malformed token or a too-short password with 400', async () => {
    expect((await reset('short', NEW_PASSWORD)).status).toBe(400);
    expect((await reset('A'.repeat(43), 'short')).status).toBe(400);
  });

  it('refuses a weak password with a coded error and keeps the link usable', async () => {
    const s = await school();
    const token = tokenOf(await requestLink(s.email, s.email));

    const weak = await reset(token, 'password1234');
    expect(weak.status).toBe(400);
    expect(weak.headers['content-type']).toContain('application/problem+json');
    const problem = problemDetailsSchema.parse(weak.body);
    expect(problem.status).toBe(400);
    expect(problem.errors?.map(({ path, code }) => ({ path, code }))).toEqual([
      { path: 'newPassword', code: 'common' },
    ]);
    expect(problem.errors?.[0]?.message).toBeTruthy();

    expect((await reset(token, NEW_PASSWORD)).status).toBe(204);
  });

  it('refuses a password containing the code of any school the user belongs to', async () => {
    const first = await school();
    const second = await school();
    await owner.membership.create({
      data: { tenantId: second.tenantId, userId: first.userId, role: 'OWNER' },
    });
    const token = tokenOf(await requestLink(first.email, first.email));

    for (const code of [first.code, second.code]) {
      const res = await reset(token, `blue ${code.toLowerCase()} sky wide`);
      expect(res.status).toBe(400);
      expect(
        problemDetailsSchema.parse(res.body).errors?.map(({ path, code }) => ({ path, code })),
      ).toEqual([{ path: 'newPassword', code: 'contains_school_code' }]);
    }
  });

  it('lets only one of several parallel resets with the same token through', async () => {
    const s = await school();
    const token = tokenOf(await requestLink(s.email, s.email));
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => reset(token, `${NEW_PASSWORD} ${i}`)),
    );
    expect(results.filter((res) => res.status === 204)).toHaveLength(1);
    expect(results.filter((res) => res.status === 410)).toHaveLength(4);
  });
});
