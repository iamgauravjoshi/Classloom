import { createHash, randomUUID } from 'node:crypto';

import {
  authSessionSchema,
  invitationPreviewSchema,
  invitationSchema,
  invitationsResponseSchema,
  twoFactorChallengeSchema,
} from '@classloom/contracts';
import type { INestApplication } from '@nestjs/common';
import { generateSync } from 'otplib';
import request from 'supertest';
import type { App } from 'supertest/types';

import { QueueProducer } from '../../src/core/queue/queue.module';
import { RedisService } from '../../src/core/redis/redis.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import { encryptSecret } from '../../src/modules/auth/secret-box';
import { SessionService } from '../../src/modules/auth/session.service';
import { generateTotpSecret } from '../../src/modules/auth/totp';
import { TwoFactorSignInService } from '../../src/modules/auth/two-factor-sign-in.service';
import { addMember, seedSchool } from '../auth/helpers';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';

const WEB_ORIGIN = 'http://localhost:3000';
const COOKIE = 'cl_session';
const PASSWORD = 'correct horse battery';
const DAY_SECONDS = 86_400;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const subjectFor = (school: string) => `You're invited to join ${school} on Classloom`;
const LINK = /http:\/\/localhost:3000\/en\/join\?token=([\w-]+)/;

interface MailSummary {
  ID: string;
  Subject: string;
  Created: string;
}

describe('invitations and joining', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let sessions: SessionService;
  let redis: RedisService;
  let counter = 0;
  let ipCounter = 0;

  const ip = () => `198.51.100.${((ipCounter += 1) % 250) + 1}`;

  /** A school with its owner (password set) and a session cookie for the owner. */
  async function school() {
    counter += 1;
    const code = `INV${counter}`;
    const email = `o${counter}@invite.test`;
    const ids = await seedSchool(owner, { code, email, password: PASSWORD });
    const { token } = await sessions.create({ ...ids, remember: false });
    return { code, email, name: `School ${code}`, ...ids, cookie: `${COOKIE}=${token}` };
  }

  /** A member with a built-in role (or a custom role id) and a session cookie. */
  async function member(
    tenantId: string,
    opts: { roleKey?: string; roleId?: string; email?: string } = {},
  ) {
    counter += 1;
    const email = opts.email ?? `m${counter}@invite.test`;
    const user = await owner.user.upsert({
      where: { email },
      create: {
        email,
        name: `Member ${counter}`,
        emailVerifiedAt: new Date(),
        passwordHash: (
          await owner.user.findFirstOrThrow({ where: { passwordHash: { not: null } } })
        ).passwordHash,
        passwordChangedAt: new Date(),
      },
      update: {},
    });
    const m = opts.roleId
      ? await owner.membership.create({ data: { tenantId, userId: user.id } })
      : await addMember(owner, tenantId, user.id, opts.roleKey ?? 'TEACHER');
    if (opts.roleId) {
      await owner.membershipRole.create({
        data: { tenantId, membershipId: m.id, roleId: opts.roleId },
      });
    }
    const { token } = await sessions.create({
      tenantId,
      userId: user.id,
      membershipId: m.id,
      remember: false,
    });
    return { userId: user.id, membershipId: m.id, email, cookie: `${COOKIE}=${token}` };
  }

  const builtIn = (tenantId: string, key: string) =>
    owner.role.findFirstOrThrow({ where: { tenantId, key } });

  async function managerWith(tenantId: string, permissions: string[] = []) {
    const role = await owner.role.create({
      data: {
        tenantId,
        name: `Manager ${randomUUID().slice(0, 8)}`,
        permissions: {
          create: ['iam.manage', 'iam.view', ...permissions].map((permission) => ({ permission })),
        },
      },
    });
    return member(tenantId, { roleId: role.id });
  }

  const get = (cookie: string, path: string) => request(server).get(path).set('Cookie', cookie);
  const post = (cookie: string, path: string, body?: object) => {
    const req = request(server).post(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN);
    return body ? req.send(body) : req;
  };

  const preview = (token: string) =>
    request(server)
      .get(`/invitations/preview?token=${encodeURIComponent(token)}`)
      .set('X-Forwarded-For', ip());
  const accept = (token: string, device?: string) => {
    const req = request(server).post('/invitations/accept').set('X-Forwarded-For', ip());
    return (device ? req.set('Cookie', `cl_device=${device}`) : req).send({ token });
  };

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

  async function invitationMails(address: string, subject: string): Promise<MailSummary[]> {
    const res = await fetch(
      `${infra.mailpitApiUrl}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    const all = ((await res.json()) as { messages: MailSummary[] }).messages;
    return all
      .filter((m) => m.Subject === subject)
      .sort((a, b) => a.Created.localeCompare(b.Created));
  }

  /** Waits for the `count`-th invitation email to `address` and returns its text and token. */
  async function nthInvitationMail(address: string, schoolName: string, count: number) {
    const subject = subjectFor(schoolName);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && (await invitationMails(address, subject)).length < count) {
      await sleep(200);
    }
    const mails = await invitationMails(address, subject);
    expect(mails.length).toBeGreaterThanOrEqual(count);
    const mail = mails[count - 1] as MailSummary;
    const body = (await (
      await fetch(`${infra.mailpitApiUrl}/api/v1/message/${mail.ID}`)
    ).json()) as { Text: string };
    const match = LINK.exec(body.Text);
    expect(match).not.toBeNull();
    return { text: body.Text, link: match?.[0] ?? '', token: match?.[1] ?? '' };
  }

  /** Invites and waits for the email, so no job is left behind. Returns the invitation and token. */
  async function invite(
    s: { cookie: string; name: string },
    body: { email: string; name: string; roleIds: string[] },
  ) {
    const res = await post(s.cookie, '/iam/invitations', body);
    expect(res.status).toBe(201);
    const invitation = invitationSchema.parse(res.body);
    const mail = await nthInvitationMail(body.email, s.name, 1);
    return { invitation, ...mail };
  }

  const nextEmail = () => {
    counter += 1;
    return `new${counter}@join.test`;
  };

  const codeAt = (secret: string) =>
    generateSync({
      secret,
      strategy: 'hotp',
      counter: Math.floor(Date.now() / 30_000),
      digits: 6,
      algorithm: 'sha1',
    });

  beforeAll(async () => {
    infra = await startTestInfra({ mailpit: true });
    app = await createApp({ ...infra.env, SIGN_IN_RATE_LIMIT_PER_15_MIN: 1000 }, { logger: false });
    await app.init();
    server = app.getHttpServer() as App;
    owner = ownerPrisma(infra.env);
    sessions = app.get(SessionService, { strict: false });
    redis = app.get(RedisService, { strict: false });
  }, 120_000);

  afterAll(async () => {
    await owner?.$disconnect();
    await app?.close();
    await infra?.stop();
  });

  describe('POST /iam/invitations', () => {
    it('creates the invitation, emails a join link and audits member.invited', async () => {
      const s = await school();
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      const classTeacher = await builtIn(s.tenantId, 'CLASS_TEACHER');
      const email = nextEmail();
      const { invitation, text, link, token } = await invite(s, {
        email: email.toUpperCase(),
        name: 'Neha Bisht',
        roleIds: [teacher.id, classTeacher.id],
      });

      expect(invitation).toMatchObject({ email, name: 'Neha Bisht', invitedBy: `Owner ${s.code}` });
      expect(invitation.roles.map((r) => r.name).sort()).toEqual(['Class Teacher', 'Teacher']);
      const expires = new Date(invitation.expiresAt).getTime() - Date.now();
      expect(expires).toBeGreaterThan(7 * DAY_SECONDS * 1000 - 60_000);
      expect(expires).toBeLessThanOrEqual(7 * DAY_SECONDS * 1000);

      expect(link.startsWith(`${WEB_ORIGIN}/en/join?token=`)).toBe(true);
      expect(token).toMatch(/^[\w-]{43}$/);
      expect(text).toContain(`Owner ${s.code} invited you to join ${s.name}`);
      expect(text).toContain('This invitation expires on');

      const row = await owner.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(Buffer.from(row.tokenHash).equals(createHash('sha256').update(token).digest())).toBe(
        true,
      );
      expect(row.invitedBy).toBe(s.userId);

      const audit = await owner.auditEvent.findMany({ where: { targetId: invitation.id } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        tenantId: s.tenantId,
        action: 'member.invited',
        targetType: 'invitation',
        actorUserId: s.userId,
      });

      const list = await get(s.cookie, '/iam/invitations');
      expect(list.status).toBe(200);
      const { invitations } = invitationsResponseSchema.parse(list.body);
      expect(invitations.map((i) => i.id)).toEqual([invitation.id]);
    });

    it('needs iam.manage to invite and iam.view to list', async () => {
      const s = await school();
      const teacher = await member(s.tenantId);
      const role = await builtIn(s.tenantId, 'TEACHER');
      const res = await post(teacher.cookie, '/iam/invitations', {
        email: nextEmail(),
        name: 'Nobody Here',
        roleIds: [role.id],
      });
      expect(res.status).toBe(403);
      expect((await get(teacher.cookie, '/iam/invitations')).status).toBe(403);
      expect((await get('', '/iam/invitations')).status).toBe(401);
    });

    it('refuses an active member with 409 already-member', async () => {
      const s = await school();
      const existing = await member(s.tenantId);
      const role = await builtIn(s.tenantId, 'TEACHER');
      const res = await post(s.cookie, '/iam/invitations', {
        email: existing.email,
        name: 'Already Here',
        roleIds: [role.id],
      });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ type: 'already-member' });
    });

    it('refuses a second open invitation to the same email with 409 already-invited', async () => {
      const s = await school();
      const role = await builtIn(s.tenantId, 'TEACHER');
      const email = nextEmail();
      await invite(s, { email, name: 'First Invite', roleIds: [role.id] });
      const again = await post(s.cookie, '/iam/invitations', {
        email,
        name: 'Second Invite',
        roleIds: [role.id],
      });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ type: 'already-invited' });
    });

    it('allows exactly one of two parallel invitations to the same email', async () => {
      const s = await school();
      const role = await builtIn(s.tenantId, 'TEACHER');
      const email = nextEmail();
      const body = { email, name: 'Racing Invite', roleIds: [role.id] };
      const results = await Promise.all([
        post(s.cookie, '/iam/invitations', body),
        post(s.cookie, '/iam/invitations', body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await owner.invitation.count({ where: { tenantId: s.tenantId, email } })).toBe(1);
      await nthInvitationMail(email, s.name, 1);
    });

    it('allows a new invitation once the old one expired or was revoked', async () => {
      const s = await school();
      const role = await builtIn(s.tenantId, 'TEACHER');
      const email = nextEmail();
      const first = await invite(s, { email, name: 'Expired Once', roleIds: [role.id] });
      await owner.invitation.update({
        where: { id: first.invitation.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await post(s.cookie, '/iam/invitations', {
        email,
        name: 'Second Chance',
        roleIds: [role.id],
      });
      expect(res.status).toBe(201);
      await nthInvitationMail(email, s.name, 2);
    });

    it('refuses a role the inviter cannot grant, and Owner from a non-owner, with 403', async () => {
      const s = await school();
      const manager = await managerWith(s.tenantId);
      const accountant = await builtIn(s.tenantId, 'ACCOUNTANT');
      const ownerRole = await builtIn(s.tenantId, 'OWNER');
      for (const roleId of [accountant.id, ownerRole.id]) {
        const res = await post(manager.cookie, '/iam/invitations', {
          email: nextEmail(),
          name: 'Escalation Try',
          roleIds: [roleId],
        });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ type: 'permission-denied' });
      }
      expect(await owner.invitation.count({ where: { tenantId: s.tenantId } })).toBe(0);
    });

    it('lets an owner invite with Owner', async () => {
      const s = await school();
      const ownerRole = await builtIn(s.tenantId, 'OWNER');
      await invite(s, { email: nextEmail(), name: 'Co Owner', roleIds: [ownerRole.id] });
    });

    it('refuses an unknown or foreign role with 400', async () => {
      const s = await school();
      const other = await school();
      const foreign = await builtIn(other.tenantId, 'TEACHER');
      for (const roleId of [foreign.id, randomUUID(), 'not-a-uuid']) {
        const res = await post(s.cookie, '/iam/invitations', {
          email: nextEmail(),
          name: 'Bad Role',
          roleIds: [roleId],
        });
        expect(res.status).toBe(400);
      }
    });

    it('answers 429 after 50 invitations in a day at one school', async () => {
      const s = await school();
      const role = await builtIn(s.tenantId, 'TEACHER');
      // 49 already sent today: the 50th goes through, the 51st does not.
      await redis.client.set(`iam:invitations:${s.tenantId}`, '49', 'EX', DAY_SECONDS);
      await invite(s, { email: nextEmail(), name: 'Fiftieth Invite', roleIds: [role.id] });
      const res = await post(s.cookie, '/iam/invitations', {
        email: nextEmail(),
        name: 'Fifty First',
        roleIds: [role.id],
      });
      expect(res.status).toBe(429);
      const ttl = await redis.client.ttl(`iam:invitations:${s.tenantId}`);
      expect(ttl).toBeGreaterThan(DAY_SECONDS - 60);
      expect(ttl).toBeLessThanOrEqual(DAY_SECONDS);
    });
  });

  describe('GET /invitations/preview', () => {
    it('shows the school, masked email, name and role names, and spends nothing', async () => {
      const s = await school();
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      const librarian = await builtIn(s.tenantId, 'LIBRARIAN');
      const email = nextEmail();
      const { invitation, token } = await invite(s, {
        email,
        name: 'Pooja Negi',
        roleIds: [teacher.id, librarian.id],
      });

      for (let i = 0; i < 2; i += 1) {
        const res = await preview(token);
        expect(res.status).toBe(200);
        const body = invitationPreviewSchema.parse(res.body);
        expect(body).toEqual({
          school: { code: s.code, name: s.name },
          email: `n***@join.test`,
          name: 'Pooja Negi',
          roles: expect.arrayContaining(['Teacher', 'Librarian']) as string[],
        });
        expect(body.roles).toHaveLength(2);
      }
      const row = await owner.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(row.acceptedAt).toBeNull();
      expect(await owner.user.count({ where: { email } })).toBe(0);
      expect((await accept(token)).status).toBe(200);
    });

    it('answers one 410 for unknown, malformed, expired, revoked and used tokens', async () => {
      const s = await school();
      const role = await builtIn(s.tenantId, 'TEACHER');
      const expired = await invite(s, {
        email: nextEmail(),
        name: 'Expired One',
        roleIds: [role.id],
      });
      await owner.invitation.update({
        where: { id: expired.invitation.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const revoked = await invite(s, {
        email: nextEmail(),
        name: 'Revoked One',
        roleIds: [role.id],
      });
      expect(
        (await post(s.cookie, `/iam/invitations/${revoked.invitation.id}/revoke`)).status,
      ).toBe(204);
      const used = await invite(s, { email: nextEmail(), name: 'Used One', roleIds: [role.id] });
      expect((await accept(used.token)).status).toBe(200);

      const bodies: unknown[] = [];
      for (const token of [
        'x'.repeat(43),
        'not a token',
        expired.token,
        revoked.token,
        used.token,
      ]) {
        const res = await preview(token);
        expect(res.status).toBe(410);
        bodies.push({ ...res.body, instance: undefined });
      }
      for (const body of bodies) expect(body).toEqual(bodies[0]);
      expect((await request(server).get('/invitations/preview')).status).toBe(400);
    });
  });

  describe('POST /invitations/accept', () => {
    it('creates the person, verifies their email, signs them in and assigns the roles', async () => {
      const s = await school();
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      const classTeacher = await builtIn(s.tenantId, 'CLASS_TEACHER');
      const email = nextEmail();
      const { invitation, token } = await invite(s, {
        email,
        name: 'Kavita Joshi',
        roleIds: [teacher.id, classTeacher.id],
      });

      const res = await accept(token);
      expect(res.status).toBe(200);
      const session = authSessionSchema.parse(res.body);
      expect(session.school).toMatchObject({ code: s.code });
      expect(session.roles.map((r) => r.key).sort()).toEqual(['CLASS_TEACHER', 'TEACHER']);
      const cookie = cookieOf(res, COOKIE);
      expect(cookie).toBeDefined();
      expect(cookieOf(res, 'cl_device')).toBeDefined();

      const user = await owner.user.findUniqueOrThrow({ where: { email } });
      expect(user.name).toBe('Kavita Joshi');
      expect(user.emailVerifiedAt).not.toBeNull();
      expect(user.passwordHash).toBeNull();
      const membership = await owner.membership.findFirstOrThrow({
        where: { tenantId: s.tenantId, userId: user.id },
        include: { roles: true },
      });
      expect(membership.status).toBe('ACTIVE');
      expect(membership.roles.map((r) => r.roleId).sort()).toEqual(
        [teacher.id, classTeacher.id].sort(),
      );
      expect(membership.roles.every((r) => r.assignedBy === s.userId)).toBe(true);

      const me = await get(`${COOKIE}=${cookie}`, '/auth/session');
      expect(me.status).toBe(200);

      const row = await owner.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(row.acceptedAt).not.toBeNull();
      const joined = await owner.auditEvent.findMany({
        where: { tenantId: s.tenantId, action: 'member.joined' },
      });
      expect(joined).toHaveLength(1);
      expect(joined[0]).toMatchObject({
        targetType: 'membership',
        targetId: membership.id,
        actorUserId: user.id,
      });
      const signIn = await owner.authEvent.findFirst({
        where: { userId: user.id, type: 'SIGN_IN_SUCCEEDED' },
      });
      expect(signIn?.method).toBe('INVITE');

      // Single use.
      expect((await accept(token)).status).toBe(410);
    });

    it('lets only one of two parallel accepts through', async () => {
      const s = await school();
      const role = await builtIn(s.tenantId, 'TEACHER');
      const email = nextEmail();
      const { token } = await invite(s, { email, name: 'Racing Joiner', roleIds: [role.id] });
      const results = await Promise.all([accept(token), accept(token)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
      expect(await owner.user.count({ where: { email } })).toBe(1);
      expect(
        await owner.membership.count({ where: { tenantId: s.tenantId, user: { email } } }),
      ).toBe(1);
    });

    it('joins an existing user from another school with no new account; their two-step applies', async () => {
      const home = await school();
      const secret = generateTotpSecret();
      await owner.user.update({
        where: { id: home.userId },
        data: {
          totpSecretEnc: new Uint8Array(encryptSecret(infra.env.TOTP_ENCRYPTION_KEY, secret)),
          totpEnabledAt: new Date(),
        },
      });
      const usersBefore = await owner.user.count();
      const s = await school();
      const role = await builtIn(s.tenantId, 'TEACHER');
      const { token } = await invite(s, {
        email: home.email,
        name: 'Ignored Name',
        roleIds: [role.id],
      });

      const res = await accept(token);
      expect(res.status).toBe(202);
      const { challenge } = twoFactorChallengeSchema.parse(res.body);
      expect(cookieOf(res, COOKIE)).toBeUndefined();
      const device = cookieOf(res, 'cl_device') as string;
      // The new school's owner is the only extra user; the invited person was not duplicated.
      expect(await owner.user.count()).toBe(usersBefore + 1);
      const user = await owner.user.findUniqueOrThrow({ where: { id: home.userId } });
      expect(user.name).toBe(`Owner ${home.code}`);

      const verified = await request(server)
        .post('/auth/two-factor/verify')
        .set('X-Forwarded-For', ip())
        .set('Cookie', `cl_device=${device}`)
        .send({ challenge, code: codeAt(secret), trustDevice: false });
      expect(verified.status).toBe(200);
      const session = authSessionSchema.parse(verified.body);
      expect(session.school).toMatchObject({ code: s.code });
      expect(session.roles.map((r) => r.key)).toEqual(['TEACHER']);
      expect(cookieOf(verified, COOKIE)).toBeDefined();

      // Their own password still signs them in to the new school, and two-step still applies.
      const signIn = await request(server)
        .post('/auth/sign-in/password')
        .set('X-Forwarded-For', ip())
        .send({ schoolCode: s.code, identifier: home.email, password: PASSWORD, remember: false });
      expect(signIn.status).toBe(202);
    });

    it('reactivates a deactivated membership with only the invited roles', async () => {
      const s = await school();
      const old = await member(s.tenantId, { roleKey: 'ACCOUNTANT' });
      await owner.membership.update({
        where: { id: old.membershipId },
        data: { status: 'DEACTIVATED', deactivatedAt: new Date() },
      });
      const librarian = await builtIn(s.tenantId, 'LIBRARIAN');
      const { token } = await invite(s, {
        email: old.email,
        name: 'Back Again',
        roleIds: [librarian.id],
      });

      const res = await accept(token);
      expect(res.status).toBe(200);
      const membership = await owner.membership.findUniqueOrThrow({
        where: { id: old.membershipId },
        include: { roles: true },
      });
      expect(membership.status).toBe('ACTIVE');
      expect(membership.deactivatedAt).toBeNull();
      expect(membership.roles.map((r) => r.roleId)).toEqual([librarian.id]);
      expect(
        await owner.membership.count({ where: { tenantId: s.tenantId, userId: old.userId } }),
      ).toBe(1);
    });

    it('reactivates a revoked seat holding Owner with only the invited roles', async () => {
      const s = await school();
      const old = await member(s.tenantId, { roleKey: 'OWNER' });
      await owner.membership.update({
        where: { id: old.membershipId },
        data: { status: 'REVOKED' },
      });
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      const { token } = await invite(s, {
        email: old.email,
        name: 'Former Owner',
        roleIds: [teacher.id],
      });
      expect((await accept(token)).status).toBe(200);
      const roles = await owner.membershipRole.findMany({
        where: { membershipId: old.membershipId },
      });
      expect(roles.map((r) => r.roleId)).toEqual([teacher.id]);
    });

    it('answers 409 already-member when the person became active meanwhile', async () => {
      const s = await school();
      const role = await builtIn(s.tenantId, 'TEACHER');
      const email = nextEmail();
      const { invitation, token } = await invite(s, {
        email,
        name: 'Became Member',
        roleIds: [role.id],
      });
      await member(s.tenantId, { email });
      const res = await accept(token);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ type: 'already-member' });
      expect(cookieOf(res, COOKIE)).toBeUndefined();
      const row = await owner.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(row.acceptedAt).toBeNull();
    });

    it('answers 410 for revoked, expired and unknown tokens, and for a school not active', async () => {
      const s = await school();
      const role = await builtIn(s.tenantId, 'TEACHER');
      const revoked = await invite(s, {
        email: nextEmail(),
        name: 'Revoked Join',
        roleIds: [role.id],
      });
      expect(
        (await post(s.cookie, `/iam/invitations/${revoked.invitation.id}/revoke`)).status,
      ).toBe(204);
      const expired = await invite(s, {
        email: nextEmail(),
        name: 'Expired Join',
        roleIds: [role.id],
      });
      await owner.invitation.update({
        where: { id: expired.invitation.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      for (const token of [revoked.token, expired.token, 'y'.repeat(43)]) {
        expect((await accept(token)).status).toBe(410);
      }

      const suspended = await school();
      const sRole = await builtIn(suspended.tenantId, 'TEACHER');
      const email = nextEmail();
      const pending = await invite(suspended, {
        email,
        name: 'Suspended Join',
        roleIds: [sRole.id],
      });
      await owner.tenant.update({
        where: { id: suspended.tenantId },
        data: { status: 'SUSPENDED', suspendedAt: new Date() },
      });
      expect((await preview(pending.token)).status).toBe(410);
      expect((await accept(pending.token)).status).toBe(410);
      expect(await owner.user.count({ where: { email } })).toBe(0);
    });

    it('skips a role deleted before accepting, and answers 410 when none is left', async () => {
      const s = await school();
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      const custom = await owner.role.create({
        data: { tenantId: s.tenantId, name: `Coach ${randomUUID().slice(0, 6)}` },
      });
      const email = nextEmail();
      const partly = await invite(s, {
        email,
        name: 'Partly Gone',
        roleIds: [teacher.id, custom.id],
      });
      const alone = await owner.role.create({
        data: { tenantId: s.tenantId, name: `Helper ${randomUUID().slice(0, 6)}` },
      });
      const lostEmail = nextEmail();
      const gone = await invite(s, { email: lostEmail, name: 'All Gone', roleIds: [alone.id] });
      await owner.role.deleteMany({ where: { id: { in: [custom.id, alone.id] } } });

      const res = await accept(partly.token);
      expect(res.status).toBe(200);
      const user = await owner.user.findUniqueOrThrow({ where: { email } });
      const roles = await owner.membershipRole.findMany({
        where: { tenantId: s.tenantId, membership: { userId: user.id } },
      });
      expect(roles.map((r) => r.roleId)).toEqual([teacher.id]);

      expect((await preview(gone.token)).status).toBe(410);
      expect((await accept(gone.token)).status).toBe(410);
      expect(await owner.user.count({ where: { email: lostEmail } })).toBe(0);
    });
  });

  describe('resend and revoke', () => {
    it('resend issues a new link and expiry; the old link stops working', async () => {
      const s = await school();
      const role = await builtIn(s.tenantId, 'TEACHER');
      const email = nextEmail();
      const first = await invite(s, { email, name: 'Resent Person', roleIds: [role.id] });
      await owner.invitation.update({
        where: { id: first.invitation.id },
        data: { expiresAt: new Date(Date.now() + 1000 * 60) },
      });

      const res = await post(s.cookie, `/iam/invitations/${first.invitation.id}/resend`);
      expect(res.status).toBe(200);
      const resent = invitationSchema.parse(res.body);
      expect(new Date(resent.expiresAt).getTime() - Date.now()).toBeGreaterThan(
        7 * DAY_SECONDS * 1000 - 60_000,
      );
      const second = await nthInvitationMail(email, s.name, 2);
      expect(second.token).not.toBe(first.token);

      expect((await preview(first.token)).status).toBe(410);
      expect((await accept(first.token)).status).toBe(410);
      expect((await accept(second.token)).status).toBe(200);
    });

    it('allows 3 resends a day per invitation; the 4th answers 429', async () => {
      const s = await school();
      const role = await builtIn(s.tenantId, 'TEACHER');
      const email = nextEmail();
      const { invitation } = await invite(s, { email, name: 'Many Resends', roleIds: [role.id] });
      for (let i = 1; i <= 3; i += 1) {
        const res = await post(s.cookie, `/iam/invitations/${invitation.id}/resend`);
        expect(res.status).toBe(200);
        await nthInvitationMail(email, s.name, i + 1);
      }
      const fourth = await post(s.cookie, `/iam/invitations/${invitation.id}/resend`);
      expect(fourth.status).toBe(429);
    });

    it('resend refuses a non-manager, an unknown id and another school’s invitation', async () => {
      const s = await school();
      const other = await school();
      const role = await builtIn(other.tenantId, 'TEACHER');
      const { invitation } = await invite(other, {
        email: nextEmail(),
        name: 'Other School',
        roleIds: [role.id],
      });
      const teacher = await member(s.tenantId);
      expect((await post(teacher.cookie, `/iam/invitations/${invitation.id}/resend`)).status).toBe(
        403,
      );
      expect((await post(s.cookie, `/iam/invitations/${invitation.id}/resend`)).status).toBe(404);
      expect((await post(s.cookie, `/iam/invitations/${invitation.id}/revoke`)).status).toBe(404);
      expect((await post(s.cookie, `/iam/invitations/${randomUUID()}/resend`)).status).toBe(404);
      expect((await post(s.cookie, '/iam/invitations/nope/revoke')).status).toBe(404);
    });

    it('resend applies the no-escalation rule to the invitation’s roles', async () => {
      const s = await school();
      const accountant = await builtIn(s.tenantId, 'ACCOUNTANT');
      const { invitation } = await invite(s, {
        email: nextEmail(),
        name: 'Finance Person',
        roleIds: [accountant.id],
      });
      const manager = await managerWith(s.tenantId);
      const res = await post(manager.cookie, `/iam/invitations/${invitation.id}/resend`);
      expect(res.status).toBe(403);
    });

    it('revoke answers 204, audits member.invite_revoked and drops it from the list', async () => {
      const s = await school();
      const role = await builtIn(s.tenantId, 'TEACHER');
      const { invitation } = await invite(s, {
        email: nextEmail(),
        name: 'Revoke Me',
        roleIds: [role.id],
      });
      const res = await post(s.cookie, `/iam/invitations/${invitation.id}/revoke`);
      expect(res.status).toBe(204);
      const audit = await owner.auditEvent.findMany({
        where: { targetId: invitation.id, action: 'member.invite_revoked' },
      });
      expect(audit).toHaveLength(1);
      const list = invitationsResponseSchema.parse((await get(s.cookie, '/iam/invitations')).body);
      expect(list.invitations).toHaveLength(0);
      // Resending a revoked invitation is not possible.
      expect((await post(s.cookie, `/iam/invitations/${invitation.id}/resend`)).status).toBe(410);
    });
  });

  describe('secrets', () => {
    it('keeps the raw token only in the email job, kept at most 7 days on failure', async () => {
      const s = await school();
      const role = await builtIn(s.tenantId, 'TEACHER');
      const added = vi.spyOn(app.get(QueueProducer), 'add');
      const email = nextEmail();
      const { invitation, token } = await invite(s, {
        email,
        name: 'Secret Keeper',
        roleIds: [role.id],
      });
      expect((await post(s.cookie, `/iam/invitations/${invitation.id}/resend`)).status).toBe(200);
      const resent = await nthInvitationMail(email, s.name, 2);
      expect((await accept(resent.token)).status).toBe(200);
      const calls = added.mock.calls;
      added.mockRestore();

      for (const raw of [token, resent.token]) {
        const carrying = calls.filter((call) => JSON.stringify(call[2]).includes(raw));
        expect(carrying).toHaveLength(1);
        expect(carrying[0]?.[0]).toBe('email');
        expect(carrying[0]?.[3]).toMatchObject({
          removeOnComplete: true,
          removeOnFail: { age: 7 * DAY_SECONDS },
        });

        const rows = await owner.$queryRaw<{ row: string }[]>`
          SELECT row_to_json(t)::text AS row FROM (
            SELECT * FROM invitations WHERE tenant_id = ${s.tenantId}::uuid) t
          UNION ALL SELECT row_to_json(a)::text FROM audit_events a
            WHERE a.tenant_id = ${s.tenantId}::uuid
          UNION ALL SELECT row_to_json(e)::text FROM auth_events e
            WHERE e.tenant_id = ${s.tenantId}::uuid`;
        expect(rows.length).toBeGreaterThan(0);
        for (const { row } of rows) expect(row).not.toContain(raw);

        // Give queued jobs (the new-device notice) time to finish before scanning Redis.
        await sleep(1000);
        for (const key of await redis.client.keys('*')) {
          expect(key).not.toContain(raw);
          const dumped = await redis.client.dumpBuffer(key);
          if (dumped) expect(dumped.includes(Buffer.from(raw))).toBe(false);
        }
      }
    });
  });

  describe('final fixes', () => {
    it('never echoes the token in a problem body and answers no-store', async () => {
      const secret = `leak-${randomUUID()}`;
      const res = await preview(secret);
      expect(res.status).toBe(410);
      expect(JSON.stringify(res.body)).not.toContain(secret);
      expect((res.body as { instance?: string }).instance).toBe(
        '/invitations/preview?token=[Redacted]',
      );
      expect(res.headers['cache-control']).toBe('no-store');
      const accepted = await accept(secret);
      expect(accepted.status).toBe(410);
      expect(accepted.headers['cache-control']).toBe('no-store');
    });

    it('answers 409 invitation-joined when the join commits but sign-in fails', async () => {
      const s = await school();
      const role = await builtIn(s.tenantId, 'TEACHER');
      const email = nextEmail();
      const { invitation, token } = await invite(s, {
        email,
        name: 'Half Joined',
        roleIds: [role.id],
      });
      const signIn = vi
        .spyOn(app.get(TwoFactorSignInService, { strict: false }), 'completeFirstFactor')
        .mockRejectedValueOnce(new Error('Redis is down'));
      const res = await accept(token);
      signIn.mockRestore();

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ type: 'invitation-joined', schoolCode: s.code });
      expect(cookieOf(res, COOKIE)).toBeUndefined();
      const user = await owner.user.findUniqueOrThrow({ where: { email } });
      const membership = await owner.membership.findUniqueOrThrow({
        where: { tenantId_userId: { tenantId: s.tenantId, userId: user.id } },
      });
      expect(membership.status).toBe('ACTIVE');
      const row = await owner.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(row.acceptedAt).not.toBeNull();
    });

    it('lets only an owner invite a deactivated owner back, at create and at accept', async () => {
      const s = await school();
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      const ownerRole = await builtIn(s.tenantId, 'OWNER');
      const gone = await member(s.tenantId, { roleKey: 'OWNER' });
      await owner.membership.update({
        where: { id: gone.membershipId },
        data: { status: 'DEACTIVATED', deactivatedAt: new Date() },
      });

      const admin = await member(s.tenantId, { roleKey: 'ADMIN' });
      const second = await member(s.tenantId, { roleKey: 'OWNER' });
      // Both roles require two-step sign-in; with it on, the setup guard stays out of the way.
      await owner.user.updateMany({
        where: { id: { in: [admin.userId, second.userId] } },
        data: { totpEnabledAt: new Date() },
      });
      const denied = await post(admin.cookie, '/iam/invitations', {
        email: gone.email,
        name: 'Former Owner',
        roleIds: [teacher.id],
      });
      expect(denied.status).toBe(403);
      expect(denied.body).toMatchObject({ type: 'permission-denied' });

      // A second owner invites, then loses Owner before the person accepts.
      const { invitation, token } = await invite(
        { cookie: second.cookie, name: s.name },
        { email: gone.email, name: 'Former Owner', roleIds: [teacher.id] },
      );
      await owner.membershipRole.deleteMany({
        where: { membershipId: second.membershipId, roleId: ownerRole.id },
      });
      const refused = await accept(token);
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ type: 'permission-denied' });
      const row = await owner.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(row.acceptedAt).toBeNull();
      const seat = await owner.membership.findUniqueOrThrow({
        where: { id: gone.membershipId },
        include: { roles: true },
      });
      expect(seat.status).toBe('DEACTIVATED');
      expect(seat.roles.map((r) => r.roleId)).toEqual([ownerRole.id]);
    });
  });
});
