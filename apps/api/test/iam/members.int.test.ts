import { randomUUID } from 'node:crypto';

import { membersPageSchema } from '@classloom/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { RedisService } from '../../src/core/redis/redis.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import { sha256 } from '../../src/modules/auth/crypto';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normaliseRecoveryCode,
} from '../../src/modules/auth/recovery-codes';
import { encryptSecret } from '../../src/modules/auth/secret-box';
import { SessionService } from '../../src/modules/auth/session.service';
import { generateTotpSecret } from '../../src/modules/auth/totp';
import { MAX_IAM_MUTATIONS_PER_HOUR } from '../../src/modules/iam/iam-limits';
import { addMember, seedSchool } from '../auth/helpers';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';

const WEB_ORIGIN = 'http://localhost:3000';
const COOKIE = 'cl_session';
const PASSWORD = 'correct horse battery';
const MINUTE = 60_000;
const SUBJECT = 'Your school turned off two-step sign-in';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Problem {
  type?: string;
  errors?: { path: string }[];
}

describe('members API', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let sessions: SessionService;
  let redis: RedisService;
  let counter = 0;
  let ipCounter = 0;

  /** A school with its owner (who can sign in with a password) and a session cookie for the owner. */
  async function school() {
    counter += 1;
    const code = `MEM${counter}`;
    const email = `o${counter}@members.test`;
    const ids = await seedSchool(owner, { code, email, password: PASSWORD });
    const { token } = await sessions.create({ ...ids, remember: false });
    return { code, email, ...ids, cookie: `${COOKIE}=${token}` };
  }

  /** A member of the school with a built-in role (or the given custom role id), with a cookie. */
  async function member(
    tenantId: string,
    opts: { roleKey?: string; roleId?: string; name?: string; email?: string } = {},
  ) {
    counter += 1;
    const email = opts.email ?? `m${counter}@members.test`;
    const user = await owner.user.create({
      data: {
        email,
        name: opts.name ?? `Member ${counter}`,
        emailVerifiedAt: new Date(),
        passwordHash: (
          await owner.user.findFirstOrThrow({ where: { passwordHash: { not: null } } })
        ).passwordHash,
        passwordChangedAt: new Date(),
      },
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

  /** A non-owner with iam.manage + iam.view (and extras) in a custom role. */
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

  async function enableTwoFactor(userId: string) {
    await owner.user.update({
      where: { id: userId },
      data: {
        totpSecretEnc: new Uint8Array(
          encryptSecret(infra.env.TOTP_ENCRYPTION_KEY, generateTotpSecret()),
        ),
        totpEnabledAt: new Date(),
        totpLastStep: 7n,
      },
    });
    await owner.recoveryCode.createMany({
      data: generateRecoveryCodes().map((c) => ({
        userId,
        codeHash: hashRecoveryCode(infra.env.AUTH_SECRET, normaliseRecoveryCode(c)),
      })),
    });
    await owner.knownDevice.create({
      data: {
        userId,
        deviceHash: new Uint8Array(sha256(`dev-${userId}`)),
        label: 'Chrome on Windows',
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        trustedUntil: new Date(Date.now() + 30 * 86_400_000),
      },
    });
  }

  const staleCookieFor = async (userId: string, tenantId: string, membershipId: string) => {
    const { token, session } = await sessions.create({
      userId,
      tenantId,
      membershipId,
      remember: false,
    });
    await owner.session.update({
      where: { id: session.id },
      data: { authenticatedAt: new Date(Date.now() - 30 * MINUTE) },
    });
    return `${COOKIE}=${token}`;
  };

  const get = (cookie: string, path: string) => request(server).get(path).set('Cookie', cookie);
  const send = (method: 'post' | 'put', cookie: string, path: string, body?: object) => {
    const req = request(server)[method](path).set('Cookie', cookie).set('Origin', WEB_ORIGIN);
    return body ? req.send(body) : req;
  };
  const signIn = (schoolCode: string, identifier: string) => {
    ipCounter += 1;
    return request(server)
      .post('/auth/sign-in/password')
      .set('X-Forwarded-For', `203.0.113.${ipCounter}`)
      .send({ schoolCode, identifier, password: PASSWORD, remember: false });
  };
  const auditRows = (tenantId: string, targetId: string) =>
    owner.auditEvent.findMany({ where: { tenantId, targetId }, orderBy: { createdAt: 'asc' } });

  async function mailsTo(address: string): Promise<{ ID: string; Subject: string }[]> {
    const res = await fetch(
      `${infra.mailpitApiUrl}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    return ((await res.json()) as { messages: { ID: string; Subject: string }[] }).messages;
  }

  async function expectMail(address: string) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && (await mailsTo(address)).length < 1) await sleep(200);
    await sleep(500);
    const mails = await mailsTo(address);
    expect(mails.map((m) => m.Subject)).toEqual([SUBJECT]);
    return (await (
      await fetch(`${infra.mailpitApiUrl}/api/v1/message/${(mails[0] as { ID: string }).ID}`)
    ).json()) as { Text: string };
  }

  beforeAll(async () => {
    infra = await startTestInfra({ mailpit: true });
    app = await createApp(infra.env, { logger: false });
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

  describe('GET /iam/members', () => {
    it('lists members with roles, status, two-step flag and last sign-in', async () => {
      const s = await school();
      const teacher = await member(s.tenantId, { name: 'Anita Sharma' });
      await enableTwoFactor(teacher.userId);
      await owner.authEvent.createMany({
        data: [
          {
            type: 'SIGN_IN_SUCCEEDED',
            userId: teacher.userId,
            tenantId: s.tenantId,
            createdAt: new Date('2026-10-01T10:00:00Z'),
          },
          {
            type: 'SIGN_IN_SUCCEEDED',
            userId: teacher.userId,
            tenantId: s.tenantId,
            createdAt: new Date('2026-10-05T10:00:00Z'),
          },
          { type: 'SIGN_IN_FAILED', userId: teacher.userId, tenantId: s.tenantId },
        ],
      });
      // A sign-in at another school must not count.
      const other = await school();
      await owner.authEvent.create({
        data: {
          type: 'SIGN_IN_SUCCEEDED',
          userId: teacher.userId,
          tenantId: other.tenantId,
          createdAt: new Date('2026-10-20T10:00:00Z'),
        },
      });

      const res = await get(s.cookie, '/iam/members');
      expect(res.status).toBe(200);
      const page = membersPageSchema.parse(res.body);
      expect(page.nextCursor).toBeNull();
      const anita = page.members.find((m) => m.membershipId === teacher.membershipId);
      expect(anita).toMatchObject({
        userId: teacher.userId,
        name: 'Anita Sharma',
        status: 'ACTIVE',
        twoFactorEnabled: true,
        lastSignInAt: '2026-10-05T10:00:00.000Z',
        roles: [{ key: 'TEACHER', name: 'Teacher' }],
      });
      const me = page.members.find((m) => m.membershipId === s.membershipId);
      expect(me).toMatchObject({ twoFactorEnabled: false, lastSignInAt: null });
      expect(me?.roles.map((r) => r.key)).toEqual(['OWNER']);
    });

    it('needs iam.view', async () => {
      const s = await school();
      const teacher = await member(s.tenantId);
      expect((await get(teacher.cookie, '/iam/members')).status).toBe(403);
      expect((await get('', '/iam/members')).status).toBe(401);
    });

    it('pages 25 at a time by name, with no gaps or repeats', async () => {
      const s = await school();
      for (let i = 0; i < 29; i += 1) {
        await member(s.tenantId, { name: `Person ${String(i).padStart(2, '0')}` });
      }
      const first = membersPageSchema.parse((await get(s.cookie, '/iam/members')).body);
      expect(first.members).toHaveLength(25);
      expect(first.nextCursor).not.toBeNull();
      const second = membersPageSchema.parse(
        (await get(s.cookie, `/iam/members?cursor=${encodeURIComponent(first.nextCursor ?? '')}`))
          .body,
      );
      expect(second.members).toHaveLength(5);
      expect(second.nextCursor).toBeNull();
      const all = [...first.members, ...second.members];
      expect(new Set(all.map((m) => m.membershipId)).size).toBe(30);
      const names = all.map((m) => m.name);
      expect(names.slice(0, 29)).toEqual([...names.slice(0, 29)].sort());
    });

    it('searches name or email case-insensitively and filters by role and status', async () => {
      const s = await school();
      await member(s.tenantId, { name: 'Anita Sharma', email: 'anita@x.test' });
      const ravi = await member(s.tenantId, {
        name: 'Ravi Kumar',
        email: 'RAVI.K@x.test',
        roleKey: 'ACCOUNTANT',
      });
      await send('post', s.cookie, `/iam/members/${ravi.membershipId}/deactivate`);

      const names = async (query: string) =>
        membersPageSchema
          .parse((await get(s.cookie, `/iam/members?${query}`)).body)
          .members.map((m) => m.name);
      expect(await names('search=ANITA')).toEqual(['Anita Sharma']);
      expect(await names('search=ravi.k@X')).toEqual(['Ravi Kumar']);
      expect(await names('search=nobody')).toEqual([]);
      const accountant = await builtIn(s.tenantId, 'ACCOUNTANT');
      expect(await names(`roleId=${accountant.id}`)).toEqual(['Ravi Kumar']);
      expect(await names('status=DEACTIVATED')).toEqual(['Ravi Kumar']);
      expect(await names('status=ACTIVE')).toEqual(['Anita Sharma', `Owner ${s.code}`]);
    });

    it('hides REVOKED memberships unless asked and never shows another school', async () => {
      const s = await school();
      const other = await school();
      const gone = await member(s.tenantId, { name: 'Gone Person' });
      await owner.membership.update({
        where: { id: gone.membershipId },
        data: { status: 'REVOKED' },
      });
      const all = membersPageSchema.parse((await get(s.cookie, '/iam/members')).body);
      expect(all.members.map((m) => m.membershipId)).toEqual([s.membershipId]);
      const revoked = membersPageSchema.parse(
        (await get(s.cookie, '/iam/members?status=REVOKED')).body,
      );
      expect(revoked.members.map((m) => m.membershipId)).toEqual([gone.membershipId]);
      expect(all.members.some((m) => m.membershipId === other.membershipId)).toBe(false);
    });

    it('rejects a malformed cursor', async () => {
      const s = await school();
      expect((await get(s.cookie, '/iam/members?cursor=%%%')).status).toBe(400);
      expect((await get(s.cookie, '/iam/members?cursor=bm90IGpzb24')).status).toBe(400);
    });
  });

  describe('PUT /iam/members/:id/roles', () => {
    it('replaces the roles, audits the change and applies it to the next request', async () => {
      const s = await school();
      const t = await member(s.tenantId);
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      const accountant = await builtIn(s.tenantId, 'ACCOUNTANT');
      expect((await get(t.cookie, '/iam/members')).status).toBe(403);

      const res = await send('put', s.cookie, `/iam/members/${t.membershipId}/roles`, {
        roleIds: [accountant.id, teacher.id, accountant.id],
      });
      expect(res.status).toBe(200);
      expect((res.body as { roles: { key: string }[] }).roles.map((r) => r.key).sort()).toEqual([
        'ACCOUNTANT',
        'TEACHER',
      ]);
      const rows = await auditRows(s.tenantId, t.membershipId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'member.roles_changed',
        targetType: 'membership',
        actorUserId: s.userId,
      });
      expect(rows[0]?.before).toEqual({ roleIds: [teacher.id] });
      expect((rows[0]?.after as { roleIds: string[] }).roleIds.sort()).toEqual(
        [accountant.id, teacher.id].sort(),
      );

      // Nothing to change: no new audit row.
      await send('put', s.cookie, `/iam/members/${t.membershipId}/roles`, {
        roleIds: [teacher.id, accountant.id],
      });
      expect(await auditRows(s.tenantId, t.membershipId)).toHaveLength(1);
    });

    it('refuses an empty list (400) and unknown or foreign roles (400)', async () => {
      const s = await school();
      const other = await school();
      const t = await member(s.tenantId);
      const path = `/iam/members/${t.membershipId}/roles`;
      expect((await send('put', s.cookie, path, { roleIds: [] })).status).toBe(400);
      expect((await send('put', s.cookie, path, { roleIds: [randomUUID()] })).status).toBe(400);
      expect((await send('put', s.cookie, path, { roleIds: ['nope'] })).status).toBe(400);
      const foreign = await builtIn(other.tenantId, 'TEACHER');
      expect((await send('put', s.cookie, path, { roleIds: [foreign.id] })).status).toBe(400);
    });

    it('404s for a member of another school or an unknown id', async () => {
      const s = await school();
      const other = await school();
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      for (const id of [other.membershipId, randomUUID(), 'nope']) {
        const res = await send('put', s.cookie, `/iam/members/${id}/roles`, {
          roleIds: [teacher.id],
        });
        expect(res.status).toBe(404);
      }
    });

    it('lets only an owner assign Owner (403), and only an owner remove it', async () => {
      const s = await school();
      const manager = await managerWith(s.tenantId, ['students.view']);
      const t = await member(s.tenantId);
      const ownerRole = await builtIn(s.tenantId, 'OWNER');
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      const toOwner = await send('put', manager.cookie, `/iam/members/${t.membershipId}/roles`, {
        roleIds: [ownerRole.id],
      });
      expect(toOwner.status).toBe(403);
      expect((toOwner.body as Problem).type).toBe('permission-denied');

      // A second owner exists, so removing Owner from them is not a last-owner case.
      const second = await member(s.tenantId, { roleKey: 'OWNER' });
      const fromOwner = await send(
        'put',
        manager.cookie,
        `/iam/members/${second.membershipId}/roles`,
        { roleIds: [teacher.id] },
      );
      expect(fromOwner.status).toBe(403);
      expect(
        (
          await send('put', s.cookie, `/iam/members/${second.membershipId}/roles`, {
            roleIds: [teacher.id],
          })
        ).status,
      ).toBe(200);
    });

    it('refuses roles with permissions the actor lacks, on adding and on removing', async () => {
      const s = await school();
      const manager = await managerWith(s.tenantId); // iam.* only
      const t = await member(s.tenantId); // Teacher
      const accountant = await builtIn(s.tenantId, 'ACCOUNTANT');
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      const add = await send('put', manager.cookie, `/iam/members/${t.membershipId}/roles`, {
        roleIds: [teacher.id, accountant.id],
      });
      expect(add.status).toBe(403);
      expect((add.body as Problem).type).toBe('permission-denied');
      // Removing Teacher (which the manager does not fully hold) is refused as well.
      const remove = await send('put', manager.cookie, `/iam/members/${t.membershipId}/roles`, {
        roleIds: [accountant.id],
      });
      expect(remove.status).toBe(403);
      const roles = await owner.membershipRole.findMany({
        where: { membershipId: t.membershipId },
      });
      expect(roles.map((r) => r.roleId)).toEqual([teacher.id]);
    });

    it('allows a manager to give a role the manager fully holds', async () => {
      const s = await school();
      const manager = await managerWith(s.tenantId, ['students.view', 'parents.view']);
      const t = await member(s.tenantId);
      const custom = await owner.role.create({
        data: {
          tenantId: s.tenantId,
          name: 'Viewer',
          permissions: { create: [{ permission: 'students.view' }] },
        },
      });
      const res = await send('put', manager.cookie, `/iam/members/${t.membershipId}/roles`, {
        roleIds: [custom.id],
      });
      // Removing Teacher needs the manager to hold Teacher's permissions, which they do not.
      expect(res.status).toBe(403);
      const t2 = await member(s.tenantId, { roleId: custom.id });
      const ok = await send('put', manager.cookie, `/iam/members/${t2.membershipId}/roles`, {
        roleIds: [custom.id],
      });
      expect(ok.status).toBe(200);
    });

    it('refuses to remove the last owner (409 last-owner), counting only ACTIVE owners', async () => {
      const s = await school();
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      // REVOKED and DEACTIVATED owners do not count.
      const revoked = await member(s.tenantId, { roleKey: 'OWNER' });
      await owner.membership.update({
        where: { id: revoked.membershipId },
        data: { status: 'REVOKED' },
      });
      const res = await send('put', s.cookie, `/iam/members/${s.membershipId}/roles`, {
        roleIds: [teacher.id],
      });
      expect(res.status).toBe(409);
      expect((res.body as Problem).type).toBe('last-owner');
      expect(await auditRows(s.tenantId, s.membershipId)).toHaveLength(0);

      // With a second active owner it is fine.
      await member(s.tenantId, { roleKey: 'OWNER' });
      const ok = await send('put', s.cookie, `/iam/members/${s.membershipId}/roles`, {
        roleIds: [teacher.id],
      });
      expect(ok.status).toBe(200);
    });

    it('needs iam.manage and counts against the mutation limit', async () => {
      const s = await school();
      const teacher = await member(s.tenantId);
      const role = await builtIn(s.tenantId, 'TEACHER');
      const denied = await send('put', teacher.cookie, `/iam/members/${s.membershipId}/roles`, {
        roleIds: [role.id],
      });
      expect(denied.status).toBe(403);

      await redis.client.set(`iam:mutations:${s.userId}`, MAX_IAM_MUTATIONS_PER_HOUR, 'EX', 3600);
      const t = await member(s.tenantId);
      const limited = await send('put', s.cookie, `/iam/members/${t.membershipId}/roles`, {
        roleIds: [role.id],
      });
      expect(limited.status).toBe(429);
    });
  });

  describe('deactivating and reactivating', () => {
    it('ends the person’s sessions at this school only, blocks sign-in, and audits', async () => {
      const s = await school();
      const other = await school();
      const t = await member(s.tenantId, { name: 'Anita Sharma' });
      // The same person is also a member of another school, with a live session there.
      const elsewhere = await addMember(owner, other.tenantId, t.userId, 'TEACHER');
      const { token: otherToken } = await sessions.create({
        userId: t.userId,
        tenantId: other.tenantId,
        membershipId: elsewhere.id,
        remember: false,
      });
      const otherCookie = `${COOKIE}=${otherToken}`;
      // Teacher cookies cannot call iam routes, so probe with the session endpoint.
      expect((await get(t.cookie, '/auth/session')).status).toBe(200);

      const res = await send('post', s.cookie, `/iam/members/${t.membershipId}/deactivate`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ membershipId: t.membershipId, status: 'DEACTIVATED' });

      expect((await get(t.cookie, '/auth/session')).status).toBe(401);
      const revoked = await owner.session.findMany({ where: { membershipId: t.membershipId } });
      expect(revoked.every((r) => r.revokedAt && r.revokedReason === 'MEMBER_DEACTIVATED')).toBe(
        true,
      );
      expect((await get(otherCookie, '/auth/session')).status).toBe(200);

      const attempt = await signIn(s.code, t.email);
      expect(attempt.status).toBe(401);
      expect((await signIn(other.code, t.email)).status).toBe(200);

      const row = await owner.membership.findUniqueOrThrow({ where: { id: t.membershipId } });
      expect(row.status).toBe('DEACTIVATED');
      expect(row.deactivatedAt).not.toBeNull();
      const audit = await auditRows(s.tenantId, t.membershipId);
      expect(audit.map((a) => a.action)).toEqual(['member.deactivated']);
      expect(audit[0]).toMatchObject({ actorUserId: s.userId, targetType: 'membership' });
    });

    it('reactivation restores sign-in and audits', async () => {
      const s = await school();
      const t = await member(s.tenantId);
      await send('post', s.cookie, `/iam/members/${t.membershipId}/deactivate`);
      expect((await signIn(s.code, t.email)).status).toBe(401);

      const res = await send('post', s.cookie, `/iam/members/${t.membershipId}/reactivate`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ACTIVE' });
      expect((await signIn(s.code, t.email)).status).toBe(200);
      const row = await owner.membership.findUniqueOrThrow({ where: { id: t.membershipId } });
      expect(row.deactivatedAt).toBeNull();
      expect((await auditRows(s.tenantId, t.membershipId)).map((a) => a.action)).toEqual([
        'member.deactivated',
        'member.reactivated',
      ]);
    });

    it('refuses to deactivate yourself (400)', async () => {
      const s = await school();
      await member(s.tenantId, { roleKey: 'OWNER' });
      const res = await send('post', s.cookie, `/iam/members/${s.membershipId}/deactivate`);
      expect(res.status).toBe(400);
      expect(
        (await owner.membership.findUniqueOrThrow({ where: { id: s.membershipId } })).status,
      ).toBe('ACTIVE');
    });

    it('refuses to deactivate the last owner (409 last-owner)', async () => {
      const s = await school();
      // A REVOKED owner is a migration artefact and does not count.
      const revoked = await member(s.tenantId, { roleKey: 'OWNER' });
      await owner.membership.update({
        where: { id: revoked.membershipId },
        data: { status: 'REVOKED' },
      });
      const manager = await managerWith(s.tenantId);
      const res = await send('post', manager.cookie, `/iam/members/${s.membershipId}/deactivate`);
      expect(res.status).toBe(409);
      expect((res.body as Problem).type).toBe('last-owner');
      expect(
        (await owner.membership.findUniqueOrThrow({ where: { id: s.membershipId } })).status,
      ).toBe('ACTIVE');
      expect(await auditRows(s.tenantId, s.membershipId)).toHaveLength(0);
    });

    it('lets only an owner deactivate or reactivate an owner', async () => {
      const s = await school();
      const second = await member(s.tenantId, { roleKey: 'OWNER' });
      const manager = await managerWith(s.tenantId);
      const denied = await send(
        'post',
        manager.cookie,
        `/iam/members/${second.membershipId}/deactivate`,
      );
      expect(denied.status).toBe(403);
      expect((denied.body as Problem).type).toBe('permission-denied');

      expect(
        (await send('post', s.cookie, `/iam/members/${second.membershipId}/deactivate`)).status,
      ).toBe(200);
      expect(
        (await send('post', manager.cookie, `/iam/members/${second.membershipId}/reactivate`))
          .status,
      ).toBe(403);
      expect(
        (await send('post', s.cookie, `/iam/members/${second.membershipId}/reactivate`)).status,
      ).toBe(200);
    });

    it('needs iam.manage and 404s for another school', async () => {
      const s = await school();
      const other = await school();
      const teacher = await member(s.tenantId);
      expect(
        (await send('post', teacher.cookie, `/iam/members/${s.membershipId}/deactivate`)).status,
      ).toBe(403);
      expect(
        (await send('post', s.cookie, `/iam/members/${other.membershipId}/deactivate`)).status,
      ).toBe(404);
      expect(
        (await send('post', s.cookie, `/iam/members/${other.membershipId}/reactivate`)).status,
      ).toBe(404);
    });
  });

  describe('POST /iam/members/:id/reset-two-factor', () => {
    it('clears two-step, codes and trust, ends sessions everywhere, emails and audits', async () => {
      const s = await school();
      const other = await school();
      const t = await member(s.tenantId);
      await enableTwoFactor(t.userId);
      const elsewhere = await addMember(owner, other.tenantId, t.userId, 'TEACHER');
      const { token } = await sessions.create({
        userId: t.userId,
        tenantId: other.tenantId,
        membershipId: elsewhere.id,
        remember: false,
      });

      const res = await send('post', s.cookie, `/iam/members/${t.membershipId}/reset-two-factor`);
      expect(res.status).toBe(204);

      const user = await owner.user.findUniqueOrThrow({ where: { id: t.userId } });
      expect(user).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null });
      expect(await owner.recoveryCode.count({ where: { userId: t.userId } })).toBe(0);
      expect(
        await owner.knownDevice.count({
          where: { userId: t.userId, trustedUntil: { not: null } },
        }),
      ).toBe(0);
      const all = await owner.session.findMany({ where: { userId: t.userId } });
      expect(all).toHaveLength(2);
      expect(all.every((r) => r.revokedAt && r.revokedReason === 'TWO_FACTOR_DISABLED')).toBe(true);
      expect((await get(`${COOKIE}=${token}`, '/auth/session')).status).toBe(401);

      const audit = await auditRows(s.tenantId, t.membershipId);
      expect(audit.map((a) => a.action)).toEqual(['member.two_factor_reset']);
      expect(audit[0]).toMatchObject({ actorUserId: s.userId, targetType: 'membership' });
      const event = await owner.authEvent.findFirst({
        where: { userId: t.userId, type: 'TWO_FACTOR_DISABLED' },
      });
      expect(event?.tenantId).toBe(s.tenantId);

      const mail = await expectMail(t.email);
      expect(mail.Text).toContain(`School ${s.code}`);
      expect(mail.Text).toContain(`${WEB_ORIGIN}/en/account/security`);
      const refreshed = membersPageSchema.parse((await get(s.cookie, '/iam/members')).body);
      expect(refreshed.members.find((m) => m.userId === t.userId)?.twoFactorEnabled).toBe(false);
    });

    it('needs the actor’s recent sign-in (403 recent-sign-in-required)', async () => {
      const s = await school();
      const t = await member(s.tenantId);
      await enableTwoFactor(t.userId);
      const stale = await staleCookieFor(s.userId, s.tenantId, s.membershipId);
      const res = await send('post', stale, `/iam/members/${t.membershipId}/reset-two-factor`);
      expect(res.status).toBe(403);
      expect((res.body as Problem).type).toMatch(/recent-sign-in-required$/);
      expect(
        (await owner.user.findUniqueOrThrow({ where: { id: t.userId } })).totpSecretEnc,
      ).not.toBeNull();
    });

    it('is 409 when the person has no two-step', async () => {
      const s = await school();
      const t = await member(s.tenantId);
      const res = await send('post', s.cookie, `/iam/members/${t.membershipId}/reset-two-factor`);
      expect(res.status).toBe(409);
      expect(await auditRows(s.tenantId, t.membershipId)).toHaveLength(0);
    });

    it('refuses a non-owner resetting an owner (403) and resetting yourself (400)', async () => {
      const s = await school();
      await enableTwoFactor(s.userId);
      const manager = await managerWith(s.tenantId);
      const res = await send(
        'post',
        manager.cookie,
        `/iam/members/${s.membershipId}/reset-two-factor`,
      );
      expect(res.status).toBe(403);
      expect((res.body as Problem).type).toBe('permission-denied');

      const self = await send('post', s.cookie, `/iam/members/${s.membershipId}/reset-two-factor`);
      expect(self.status).toBe(400);
      expect(
        (await owner.user.findUniqueOrThrow({ where: { id: s.userId } })).totpSecretEnc,
      ).not.toBeNull();
    });

    it('lets an owner reset another owner', async () => {
      const s = await school();
      const second = await member(s.tenantId, { roleKey: 'OWNER' });
      await enableTwoFactor(second.userId);
      const res = await send(
        'post',
        s.cookie,
        `/iam/members/${second.membershipId}/reset-two-factor`,
      );
      expect(res.status).toBe(204);
    });

    it('needs iam.manage and counts against the mutation limit', async () => {
      const s = await school();
      const t = await member(s.tenantId);
      const teacher = await member(s.tenantId);
      expect(
        (await send('post', teacher.cookie, `/iam/members/${t.membershipId}/reset-two-factor`))
          .status,
      ).toBe(403);
      await redis.client.set(`iam:mutations:${s.userId}`, MAX_IAM_MUTATIONS_PER_HOUR, 'EX', 3600);
      expect(
        (await send('post', s.cookie, `/iam/members/${t.membershipId}/reset-two-factor`)).status,
      ).toBe(429);
    });
  });

  describe('fix round 1', () => {
    it('serialises parallel demotions of the last two owners (exactly one 409)', async () => {
      for (let round = 0; round < 3; round += 1) {
        const s = await school();
        const second = await member(s.tenantId, { roleKey: 'OWNER' });
        const teacher = await builtIn(s.tenantId, 'TEACHER');
        const [a, b] = await Promise.all([
          send('put', s.cookie, `/iam/members/${second.membershipId}/roles`, {
            roleIds: [teacher.id],
          }),
          send('put', second.cookie, `/iam/members/${s.membershipId}/roles`, {
            roleIds: [teacher.id],
          }),
        ]);
        expect([a.status, b.status].sort()).toEqual([200, 409]);
        const owners = await owner.membership.count({
          where: {
            tenantId: s.tenantId,
            status: 'ACTIVE',
            roles: { some: { role: { key: 'OWNER' } } },
          },
        });
        expect(owners).toBe(1);
      }
    });

    it('keeps an owner when a demotion races a deactivation', async () => {
      for (let round = 0; round < 3; round += 1) {
        const s = await school();
        const second = await member(s.tenantId, { roleKey: 'OWNER' });
        const teacher = await builtIn(s.tenantId, 'TEACHER');
        const [a, b] = await Promise.all([
          send('put', s.cookie, `/iam/members/${second.membershipId}/roles`, {
            roleIds: [teacher.id],
          }),
          send('post', second.cookie, `/iam/members/${s.membershipId}/deactivate`),
        ]);
        expect([a.status, b.status].filter((c) => c === 409)).toHaveLength(1);
        const owners = await owner.membership.count({
          where: {
            tenantId: s.tenantId,
            status: 'ACTIVE',
            roles: { some: { role: { key: 'OWNER' } } },
          },
        });
        expect(owners).toBe(1);
      }
    });

    it('treats an upper-case copy of your own id as yourself (400)', async () => {
      const s = await school();
      await member(s.tenantId, { roleKey: 'OWNER' });
      await enableTwoFactor(s.userId);
      const id = s.membershipId.toUpperCase();
      expect((await send('post', s.cookie, `/iam/members/${id}/deactivate`)).status).toBe(400);
      expect((await send('post', s.cookie, `/iam/members/${id}/reset-two-factor`)).status).toBe(
        400,
      );
    });

    it('never resets someone who owns another school (403)', async () => {
      const s = await school();
      const other = await school();
      const t = await member(s.tenantId);
      await enableTwoFactor(t.userId);
      await addMember(owner, other.tenantId, t.userId, 'OWNER');
      const res = await send('post', s.cookie, `/iam/members/${t.membershipId}/reset-two-factor`);
      expect(res.status).toBe(403);
      expect((res.body as Problem).type).toBe('permission-denied');
      expect(
        (await owner.user.findUniqueOrThrow({ where: { id: t.userId } })).totpSecretEnc,
      ).not.toBeNull();
    });

    it('applies the escalation rule to reactivation', async () => {
      const s = await school();
      const manager = await managerWith(s.tenantId); // iam.* only
      const t = await member(s.tenantId); // Teacher
      await send('post', s.cookie, `/iam/members/${t.membershipId}/deactivate`);
      const denied = await send(
        'post',
        manager.cookie,
        `/iam/members/${t.membershipId}/reactivate`,
      );
      expect(denied.status).toBe(403);
      expect((denied.body as Problem).type).toBe('permission-denied');
      expect(
        (await owner.membership.findUniqueOrThrow({ where: { id: t.membershipId } })).status,
      ).toBe('DEACTIVATED');
      expect(
        (await send('post', s.cookie, `/iam/members/${t.membershipId}/reactivate`)).status,
      ).toBe(200);
    });

    it('rejects a roleId that is not a UUID (400)', async () => {
      const s = await school();
      expect((await get(s.cookie, '/iam/members?roleId=nope')).status).toBe(400);
    });
  });
});
