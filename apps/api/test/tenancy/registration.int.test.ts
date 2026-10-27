import { createHash } from 'node:crypto';

import { formatDateIN } from '@classloom/utils';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import type { App } from 'supertest/types';

import { EMAIL_QUEUE, EmailService } from '../../src/core/email/email.service';
import { PrismaService } from '../../src/core/prisma/prisma.service';
import { createApp } from '../../src/main';
import { REGISTRATION_QUEUE } from '../../src/modules/tenancy/school-registration.service';
import { startTestInfra, type TestInfra } from '../setup-containers';

interface MailpitSummary {
  ID: string;
  To: { Address: string }[];
}

const HOUR = 3_600_000;
const TOKEN = expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as unknown as string;

const hashOf = (token: string) =>
  createHash('sha256').update(Buffer.from(token, 'base64url')).digest();

const timeIST = (date: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);

const payload = (over: Record<string, unknown> = {}) => ({
  schoolName: 'Global International School',
  board: 'CBSE',
  city: 'Dehradun',
  state: 'UK',
  code: 'GISD',
  adminName: 'Asha Rawat',
  email: 'asha@school.in',
  acceptTerms: true,
  ...over,
});

describe('school registration', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let prisma: PrismaService;

  async function clean() {
    await prisma.$executeRawUnsafe('DELETE FROM "tenants"');
    await prisma.$executeRawUnsafe('DELETE FROM "users"');
    await fetch(`${infra.mailpitApiUrl}/api/v1/messages`, { method: 'DELETE' });
    await infra.redis.executeCliCmd('flushall');
  }

  async function mails(expected: number): Promise<MailpitSummary[]> {
    const deadline = Date.now() + 10_000;
    let messages: MailpitSummary[] = [];
    while (Date.now() < deadline) {
      const res = await fetch(`${infra.mailpitApiUrl}/api/v1/messages`);
      messages = ((await res.json()) as { messages: MailpitSummary[] }).messages;
      if (messages.length >= expected) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return messages;
  }

  /** Waits until a queue has no active or waiting jobs, then a little longer for side effects. */
  async function drain(name: string) {
    const queue = app.get<Queue>(getQueueToken(name));
    const deadline = Date.now() + 5000;
    while (
      Date.now() < deadline &&
      (await queue.getActiveCount()) + (await queue.getWaitingCount()) > 0
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  /** Token from the newest email's link (Mailpit lists newest first). */
  async function latestToken(expected: number): Promise<string> {
    const first = (await mails(expected))[0];
    if (!first) throw new Error('no email');
    const res = await fetch(`${infra.mailpitApiUrl}/api/v1/message/${first.ID}`);
    const { Text } = (await res.json()) as { Text: string };
    const match = /\/register-school\/verify\?token=([A-Za-z0-9_-]{43})/.exec(Text);
    if (!match?.[1]) throw new Error(`no link in: ${Text}`);
    return match[1];
  }

  beforeAll(async () => {
    infra = await startTestInfra({ mailpit: true });
    app = await createApp(
      { ...infra.env, REGISTRATION_RATE_LIMIT_PER_HOUR: 1000 },
      { logger: false },
    );
    await app.init();
    server = app.getHttpServer() as App;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
    await infra?.stop();
  });

  beforeEach(clean);

  it('registers, emails a link, and verifies once', async () => {
    const res = await request(server).post('/school-registrations').send(payload());
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ maskedEmail: 'a***@school.in', cancelToken: TOKEN });

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { code: 'GISD' } });
    expect(tenant.status).toBe('PENDING_VERIFICATION');
    expect(tenant.code).toBe('GISD');
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return {
        campuses: await tx.campus.findMany(),
        memberships: await tx.membership.findMany(),
      };
    });
    expect(rows.campuses).toHaveLength(1);
    expect(rows.campuses[0]).toMatchObject({ isPrimary: true, city: 'Dehradun', state: 'UK' });
    expect(rows.memberships).toHaveLength(1);
    expect(rows.memberships[0]?.role).toBe('OWNER');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'asha@school.in' } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(await prisma.registrationToken.count({ where: { tenantId: tenant.id } })).toBe(1);

    const token = await latestToken(1);
    expect((await mails(1))[0]?.To[0]?.Address).toBe('asha@school.in');

    const verified = await request(server).post('/school-registrations/verify').send({ token });
    expect(verified.status).toBe(200);
    expect(verified.body).toEqual({ code: 'GISD', name: 'Global International School' });

    const after = await prisma.tenant.findUniqueOrThrow({ where: { code: 'GISD' } });
    expect(after.status).toBe('ACTIVE');
    expect(after.verifiedAt).not.toBeNull();
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email: 'asha@school.in' } })).emailVerifiedAt,
    ).not.toBeNull();

    const again = await request(server).post('/school-registrations/verify').send({ token });
    expect(again.status).toBe(410);
    expect(again.headers['content-type']).toContain('application/problem+json');
  });

  it('returns 410 for an expired token and for an unknown token', async () => {
    await request(server).post('/school-registrations').send(payload());
    const token = await latestToken(1);
    const hash = createHash('sha256').update(Buffer.from(token, 'base64url')).digest();
    await prisma.registrationToken.update({
      where: { tokenHash: hash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (await request(server).post('/school-registrations/verify').send({ token })).status,
    ).toBe(410);
    const unknown = 'A'.repeat(43);
    expect(
      (await request(server).post('/school-registrations/verify').send({ token: unknown })).status,
    ).toBe(410);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { code: 'GISD' } })).status).toBe(
      'PENDING_VERIFICATION',
    );
  });

  it('resend issues a new email and invalidates the old token', async () => {
    await request(server).post('/school-registrations').send(payload());
    const oldToken = await latestToken(1);
    const res = await request(server)
      .post('/school-registrations/resend')
      .send({ email: ' Asha@School.IN ', code: 'gisd' });
    expect(res.status).toBe(202);
    expect(await mails(2)).toHaveLength(2);
    const newToken = await latestToken(2);
    expect(newToken).not.toBe(oldToken);
    expect(
      (await request(server).post('/school-registrations/verify').send({ token: oldToken })).status,
    ).toBe(410);
    expect(
      (await request(server).post('/school-registrations/verify').send({ token: newToken })).status,
    ).toBe(200);
  });

  it('a link resent at hour 40 expires at hour 48, when the registration is purged', async () => {
    await request(server).post('/school-registrations').send(payload());
    await mails(1);
    const createdAt = new Date(Date.now() - 40 * HOUR);
    await prisma.tenant.update({ where: { code: 'GISD' }, data: { createdAt } });

    await request(server)
      .post('/school-registrations/resend')
      .send({ email: 'asha@school.in', code: 'GISD' });
    const token = await latestToken(2);
    const record = await prisma.registrationToken.findUniqueOrThrow({
      where: { tokenHash: hashOf(token) },
    });
    const purgeAt = new Date(createdAt.getTime() + 48 * HOUR);
    expect(record.expiresAt).toEqual(purgeAt);

    // The email states the capped time, so its promise holds.
    const first = (await mails(2))[0];
    const res = await fetch(`${infra.mailpitApiUrl}/api/v1/message/${first?.ID}`);
    const { Text } = (await res.json()) as { Text: string };
    expect(Text).toContain(`${formatDateIN(purgeAt)} at ${timeIST(purgeAt)} IST`);
  });

  it('sends no new link once the registration is past its purge time', async () => {
    await request(server).post('/school-registrations').send(payload());
    await mails(1);
    await prisma.tenant.update({
      where: { code: 'GISD' },
      data: { createdAt: new Date(Date.now() - 49 * HOUR) },
    });
    const res = await request(server)
      .post('/school-registrations/resend')
      .send({ email: 'asha@school.in', code: 'GISD' });
    expect(res.status).toBe(202);
    await drain(REGISTRATION_QUEUE);
    expect(await mails(1)).toHaveLength(1);
    expect(await prisma.registrationToken.count({ where: { usedAt: null } })).toBe(1);
  });

  it('resend for an unknown school or wrong email is a silent 202 with no email', async () => {
    await request(server).post('/school-registrations').send(payload());
    await mails(1);
    const wrongEmail = await request(server)
      .post('/school-registrations/resend')
      .send({ email: 'someone@else.in', code: 'GISD' });
    const unknown = await request(server)
      .post('/school-registrations/resend')
      .send({ email: 'asha@school.in', code: 'NOPE' });
    expect(wrongEmail.status).toBe(202);
    expect(unknown.status).toBe(202);
    // The resend job runs in the background: wait for it to finish, then confirm no email.
    const jobs = app.get<Queue>(getQueueToken(REGISTRATION_QUEUE));
    const deadline = Date.now() + 5000;
    while (
      Date.now() < deadline &&
      (await jobs.getActiveCount()) + (await jobs.getWaitingCount()) > 0
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await mails(1)).toHaveLength(1);
  });

  it('limits resend to 3 per hour per email and code', async () => {
    await request(server).post('/school-registrations').send(payload());
    const send = () =>
      request(server)
        .post('/school-registrations/resend')
        .send({ email: 'asha@school.in', code: 'GISD' });
    expect((await send()).status).toBe(202);
    expect((await send()).status).toBe(202);
    expect((await send()).status).toBe(202);
    expect((await send()).status).toBe(429);
    // Let the queued emails land so they cannot leak into the next test.
    expect(await mails(4)).toHaveLength(4);
  });

  it('returns 409 with a field error and a suggestion for a duplicate code', async () => {
    expect((await request(server).post('/school-registrations').send(payload())).status).toBe(202);
    const res = await request(server)
      .post('/school-registrations')
      .send(payload({ email: 'other@school.in', code: 'gisd' }));
    expect(res.status).toBe(409);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = res.body as { errors: { path: string; message: string }[]; suggestion: string };
    expect(body.errors[0]).toEqual({
      path: 'code',
      message: 'This school code is already taken.',
    });
    expect(body.suggestion).toBe('GISD-2');
    expect(await prisma.user.count({ where: { email: 'other@school.in' } })).toBe(0);
    expect(await mails(1)).toHaveLength(1);
  });

  it('allows only 3 pending schools per email, silently, with one user row', async () => {
    for (const code of ['SCHA', 'SCHB', 'SCHC']) {
      const res = await request(server).post('/school-registrations').send(payload({ code }));
      expect(res.status).toBe(202);
    }
    const fourth = await request(server)
      .post('/school-registrations')
      .send(payload({ code: 'SCHD', email: ' Asha@School.IN ' }));
    expect(fourth.status).toBe(202);
    // Same shape as a real registration, so the response reveals nothing.
    expect(fourth.body).toEqual({ maskedEmail: 'a***@school.in', cancelToken: TOKEN });
    expect(await prisma.tenant.count()).toBe(3);
    expect(await prisma.tenant.count({ where: { code: 'SCHD' } })).toBe(0);
    expect(await prisma.user.count({ where: { email: 'asha@school.in' } })).toBe(1);
    expect(await mails(3)).toHaveLength(3);
  });

  it('keeps no completed email jobs (they hold live verification links)', async () => {
    await request(server).post('/school-registrations').send(payload());
    await mails(1);
    const queue = app.get<Queue>(getQueueToken(EMAIL_QUEUE));
    const deadline = Date.now() + 5000;
    while (
      Date.now() < deadline &&
      (await queue.getActiveCount()) + (await queue.getWaitingCount()) > 0
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await queue.getCompletedCount()).toBe(0);
  });

  describe('cancel ("Use a different email")', () => {
    const cancel = (cancelToken: string) =>
      request(server).post('/school-registrations/cancel').send({ cancelToken });

    it('deletes the pending school and its new user, freeing the code', async () => {
      const first = await request(server).post('/school-registrations').send(payload());
      const { cancelToken } = first.body as { cancelToken: string };
      const token = await latestToken(1);

      expect((await cancel(cancelToken)).status).toBe(204);
      expect(await prisma.tenant.count()).toBe(0);
      expect(await prisma.user.count()).toBe(0);
      expect(await prisma.registrationToken.count()).toBe(0);
      // The link already emailed to the mistyped address no longer works.
      expect(
        (await request(server).post('/school-registrations/verify').send({ token })).status,
      ).toBe(410);

      const again = await request(server)
        .post('/school-registrations')
        .send(payload({ email: 'asha.rawat@school.in' }));
      expect(again.status).toBe(202);
      expect(await prisma.tenant.count({ where: { code: 'GISD' } })).toBe(1);
      // Let the queued emails land so they cannot leak into the next test.
      expect(await mails(2)).toHaveLength(2);
    });

    it('keeps a user who still has another school', async () => {
      const first = await request(server).post('/school-registrations').send(payload());
      await request(server)
        .post('/school-registrations')
        .send(payload({ code: 'OTHR' }));
      expect((await cancel((first.body as { cancelToken: string }).cancelToken)).status).toBe(204);
      expect(await prisma.tenant.count({ where: { code: 'GISD' } })).toBe(0);
      expect(await prisma.tenant.count({ where: { code: 'OTHR' } })).toBe(1);
      expect(await prisma.user.count({ where: { email: 'asha@school.in' } })).toBe(1);
      expect(await mails(2)).toHaveLength(2);
    });

    it('does nothing once the school is verified', async () => {
      const first = await request(server).post('/school-registrations').send(payload());
      const token = await latestToken(1);
      await request(server).post('/school-registrations/verify').send({ token });

      expect((await cancel((first.body as { cancelToken: string }).cancelToken)).status).toBe(204);
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { code: 'GISD' } });
      expect(tenant.status).toBe('ACTIVE');
      expect(await prisma.user.count({ where: { email: 'asha@school.in' } })).toBe(1);
    });

    it('answers 204 for an unknown token, revealing nothing', async () => {
      await request(server).post('/school-registrations').send(payload());
      expect((await cancel('A'.repeat(43))).status).toBe(204);
      expect(await prisma.tenant.count()).toBe(1);
      expect(await mails(1)).toHaveLength(1);
    });

    it('rejects a malformed token as a validation error', async () => {
      const res = await cancel('short');
      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
    });
  });

  it('rolls everything back when the email cannot be queued', async () => {
    const spy = vi
      .spyOn(app.get(EmailService), 'enqueue')
      .mockRejectedValueOnce(new Error('queue down'));
    const res = await request(server).post('/school-registrations').send(payload());
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await prisma.tenant.count()).toBe(0);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.registrationToken.count()).toBe(0);
  });
});
