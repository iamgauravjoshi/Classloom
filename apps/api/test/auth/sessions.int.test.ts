import { ALL_PERMISSIONS } from '@classloom/contracts';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';

import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import {
  AUTH_CLEANUP_JOB,
  AUTH_MAINTENANCE_QUEUE,
  AuthCleanupProcessor,
} from '../../src/modules/auth/auth-cleanup.processor';
import { AuthEventsService } from '../../src/modules/auth/auth-events.service';
import { sha256 } from '../../src/modules/auth/crypto';
import { SessionService } from '../../src/modules/auth/session.service';
import { loadMemberAccess } from '../../src/modules/iam/permissions';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';
import { seedSchool } from './helpers';

const DAY = 86_400_000;
const HOUR = 3_600_000;

describe('sessions, auth events and clean-up', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let owner: PrismaClient;
  let sessions: SessionService;
  let events: AuthEventsService;
  let cleanup: AuthCleanupProcessor;
  let counter = 0;

  async function school() {
    counter += 1;
    const code = `SES${counter}`;
    const ids = await seedSchool(owner, {
      code,
      email: `owner${counter}@ses.in`,
      mobile: `+9198000000${String(counter).padStart(2, '0')}`,
      password: 'correct horse battery',
    });
    return { code, ...ids };
  }

  const create = (s: { userId: string; tenantId: string; membershipId: string }, remember = true) =>
    sessions.create({
      userId: s.userId,
      tenantId: s.tenantId,
      membershipId: s.membershipId,
      remember,
    });

  beforeAll(async () => {
    infra = await startTestInfra();
    app = await createApp({ ...infra.env, DATABASE_MIGRATION_URL: undefined }, { logger: false });
    await app.init();
    owner = ownerPrisma(infra.env);
    sessions = app.get(SessionService, { strict: false });
    events = app.get(AuthEventsService, { strict: false });
    cleanup = app.get(AuthCleanupProcessor, { strict: false });

    // The app schedules the clean-up on boot and runs it straight away. Stop the schedule and
    // let that run finish so it cannot delete rows these tests seed.
    const queue = app.get<Queue>(getQueueToken(AUTH_MAINTENANCE_QUEUE), { strict: false });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && (await queue.getJobSchedulers()).length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect((await queue.getJobSchedulers()).map((s) => s.key)).toEqual([AUTH_CLEANUP_JOB]);
    await queue.removeJobScheduler(AUTH_CLEANUP_JOB);
    while (Date.now() < deadline) {
      const counts = await queue.getJobCounts('active', 'waiting', 'delayed');
      if ((counts.active ?? 0) + (counts.waiting ?? 0) === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  afterAll(async () => {
    await app?.close();
    await owner?.$disconnect();
    await infra?.stop();
  });

  it('stores only the hash of the token', async () => {
    const s = await school();
    const { token, session } = await create(s);

    expect(token).toHaveLength(43);
    const row = await owner.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(Buffer.from(row.tokenHash).equals(sha256(token))).toBe(true);
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('stores ip and user agent, and resolves the session with its school', async () => {
    const s = await school();
    const { token } = await sessions.create({
      userId: s.userId,
      tenantId: s.tenantId,
      membershipId: s.membershipId,
      remember: false,
      ip: '203.0.113.9',
      userAgent: 'x'.repeat(600),
    });

    const resolved = await sessions.resolve(token);
    expect(resolved?.session.userId).toBe(s.userId);
    expect(resolved?.session.ip).toBe('203.0.113.9');
    expect(resolved?.session.userAgent).toHaveLength(512);
    expect(resolved?.tenant).toEqual({
      id: s.tenantId,
      code: s.code,
      name: `School ${s.code}`,
      status: 'ACTIVE',
    });
  });

  it('does not resolve an unknown token', async () => {
    expect(await sessions.resolve('nope')).toBeNull();
  });

  it('does not resolve a revoked session', async () => {
    const s = await school();
    const { token, session } = await create(s);
    await sessions.revoke(session.id, 'SIGNED_OUT');

    expect(await sessions.resolve(token)).toBeNull();
    const row = await owner.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.revokedReason).toBe('SIGNED_OUT');
    expect(row.revokedAt).not.toBeNull();
  });

  it('does not resolve after expiresAt or idleExpiresAt', async () => {
    const s = await school();
    const remembered = await create(s, true);
    const temporary = await create(s, false);

    expect(await sessions.resolve(remembered.token)).not.toBeNull();
    expect(await sessions.resolve(remembered.token, new Date(Date.now() + 31 * DAY))).toBeNull();
    expect(await sessions.resolve(temporary.token, new Date(Date.now() + HOUR))).not.toBeNull();
    // Idle (2 h) passes long before the absolute 12 h.
    expect(await sessions.resolve(temporary.token, new Date(Date.now() + 3 * HOUR))).toBeNull();
  });

  it('refuses while the school is suspended and works again once it is active', async () => {
    const s = await school();
    const { token } = await create(s);

    await owner.tenant.update({ where: { id: s.tenantId }, data: { status: 'SUSPENDED' } });
    expect(await sessions.resolve(token)).toBeNull();

    await owner.tenant.update({ where: { id: s.tenantId }, data: { status: 'ACTIVE' } });
    expect(await sessions.resolve(token)).not.toBeNull();
  });

  it('revokes the replaced session with REPLACED', async () => {
    const s = await school();
    const first = await create(s);
    const second = await sessions.create({
      userId: s.userId,
      tenantId: s.tenantId,
      membershipId: s.membershipId,
      remember: true,
      replacesToken: first.token,
    });

    expect(await sessions.resolve(first.token)).toBeNull();
    expect(await sessions.resolve(second.token)).not.toBeNull();
    const old = await owner.session.findUniqueOrThrow({ where: { id: first.session.id } });
    expect(old.revokedReason).toBe('REPLACED');
  });

  it('ignores a replacesToken that matches nothing', async () => {
    const s = await school();
    const { token } = await sessions.create({
      userId: s.userId,
      tenantId: s.tenantId,
      membershipId: s.membershipId,
      remember: true,
      replacesToken: 'not-a-session',
    });
    expect(await sessions.resolve(token)).not.toBeNull();
  });

  it('revokeAllForUser keeps the excepted session and only touches that user', async () => {
    const s = await school();
    const other = await school();
    const a = await create(s);
    const b = await create(s);
    const c = await create(s);
    const otherSession = await create(other);

    await sessions.revokeAllForUser(s.userId, 'PASSWORD_CHANGED', b.session.id);

    expect(await sessions.resolve(a.token)).toBeNull();
    expect(await sessions.resolve(b.token)).not.toBeNull();
    expect(await sessions.resolve(c.token)).toBeNull();
    expect(await sessions.resolve(otherSession.token)).not.toBeNull();

    await sessions.revokeAllForUser(s.userId, 'PASSWORD_RESET');
    expect(await sessions.resolve(b.token)).toBeNull();
    // The reason of an already revoked session is not overwritten.
    const rowA = await owner.session.findUniqueOrThrow({ where: { id: a.session.id } });
    expect(rowA.revokedReason).toBe('PASSWORD_CHANGED');
  });

  it('touch slides a session at most every 5 minutes', async () => {
    const s = await school();
    const { token, session } = await create(s, true);

    expect(await sessions.touch(session, new Date(Date.now() + 2 * 60_000))).toEqual({
      cookieRefresh: false,
    });
    const later = new Date(Date.now() + 10 * 60_000);
    // A slide 10 minutes in does not re-send the cookie.
    expect(await sessions.touch(session, later)).toEqual({ cookieRefresh: false });

    const row = await owner.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.lastSeenAt).toEqual(later);
    expect(row.expiresAt).toEqual(new Date(later.getTime() + 30 * DAY));
    expect(await sessions.resolve(token, later)).not.toBeNull();

    const temp = await create(s, false);
    await sessions.touch(temp.session, later);
    const tempRow = await owner.session.findUniqueOrThrow({ where: { id: temp.session.id } });
    expect(tempRow.idleExpiresAt).toEqual(new Date(later.getTime() + 2 * HOUR));
    expect(tempRow.expiresAt).toEqual(temp.session.expiresAt);
  });

  it('re-sends the cookie 25 hours after the last refresh, but not again within the day', async () => {
    const s = await school();
    const { session } = await create(s, true);
    const day = new Date(session.authenticatedAt.getTime() + 25 * HOUR);

    expect(await sessions.touch(session, day)).toEqual({ cookieRefresh: true });
    const fresh = await owner.session.findUniqueOrThrow({ where: { id: session.id } });
    const soon = new Date(day.getTime() + 10 * 60_000);
    expect(await sessions.touch(fresh, soon)).toEqual({ cookieRefresh: false });
  });

  it('never refreshes the cookie of a session that is not remembered', async () => {
    const s = await school();
    const { session } = await create(s, false);
    const late = new Date(session.authenticatedAt.getTime() + 25 * HOUR);
    expect(await sessions.touch(session, late)).toEqual({ cookieRefresh: false });
  });

  it('never refreshes the cookie of a revoked session', async () => {
    const s = await school();
    const { session } = await create(s, true);
    await sessions.revoke(session.id, 'SIGNED_OUT');
    const late = new Date(session.authenticatedAt.getTime() + 25 * HOUR);
    expect(await sessions.touch(session, late)).toEqual({ cookieRefresh: false });
  });

  it('builds the contract session with the primary campus', async () => {
    const s = await school();
    const { token } = await create(s);
    const resolved = await sessions.resolve(token);
    const user = await owner.user.findUniqueOrThrow({ where: { id: s.userId } });
    const access = await loadMemberAccess(owner, s.membershipId);
    const campus = await owner.campus.findFirstOrThrow({
      where: { tenantId: s.tenantId, isPrimary: true },
    });

    const authSession = await sessions.toAuthSession(
      resolved!,
      { ...access, twoFactorSetupRequired: false },
      user,
    );

    expect(authSession).toEqual({
      user: {
        id: s.userId,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        hasPassword: true,
      },
      school: { id: s.tenantId, code: s.code, name: `School ${s.code}` },
      campus: { id: campus.id, name: campus.name },
      // The seeded member holds Owner, which means every permission.
      roles: [{ key: 'OWNER', name: 'Owner' }],
      permissions: [...ALL_PERMISSIONS],
      twoFactorSetupRequired: false,
      remember: true,
      expiresAt: resolved!.session.expiresAt.toISOString(),
    });
  });

  describe('auth events', () => {
    it('records an event and truncates the user agent to 512 characters', async () => {
      const s = await school();
      await events.record({
        type: 'SIGN_IN_SUCCEEDED',
        method: 'PASSWORD',
        userId: s.userId,
        tenantId: s.tenantId,
        ip: '198.51.100.7',
        userAgent: 'u'.repeat(1000),
      });

      const rows = await owner.authEvent.findMany({ where: { userId: s.userId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: 'SIGN_IN_SUCCEEDED',
        method: 'PASSWORD',
        tenantId: s.tenantId,
        ip: '198.51.100.7',
      });
      expect(rows[0]?.userAgent).toHaveLength(512);
    });

    it('never throws when the write fails', async () => {
      await expect(
        events.record({ type: 'SIGN_IN_FAILED', userId: '00000000-0000-7000-8000-000000000000' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('clean-up', () => {
    it('deletes old sessions and events only', async () => {
      const s = await school();
      const now = new Date();
      const old = await create(s);
      const recent = await create(s);
      const expired = await create(s);
      const live = await create(s);
      await sessions.revoke(old.session.id, 'SIGNED_OUT');
      await sessions.revoke(recent.session.id, 'SIGNED_OUT');
      await owner.session.update({
        where: { id: old.session.id },
        data: { revokedAt: new Date(now.getTime() - 8 * DAY) },
      });
      await owner.session.update({
        where: { id: recent.session.id },
        data: { revokedAt: new Date(now.getTime() - 6 * DAY) },
      });
      await owner.session.update({
        where: { id: expired.session.id },
        data: { expiresAt: new Date(now.getTime() - 8 * DAY) },
      });

      const oldEvent = await owner.authEvent.create({
        data: { type: 'SIGN_IN_FAILED', createdAt: new Date(now.getTime() - 366 * DAY) },
      });
      const recentEvent = await owner.authEvent.create({
        data: { type: 'SIGN_IN_FAILED', createdAt: new Date(now.getTime() - 364 * DAY) },
      });

      const result = await cleanup.purge(now);

      expect(result.sessions).toBeGreaterThanOrEqual(2);
      expect(result.events).toBeGreaterThanOrEqual(1);
      const ids = async (rows: Promise<{ id: string }[]>) => (await rows).map((r) => r.id);
      const left = await ids(
        owner.session.findMany({
          where: { id: { in: [old, recent, expired, live].map((x) => x.session.id) } },
        }),
      );
      expect(left.sort()).toEqual([recent.session.id, live.session.id].sort());
      const eventsLeft = await ids(
        owner.authEvent.findMany({ where: { id: { in: [oldEvent.id, recentEvent.id] } } }),
      );
      expect(eventsLeft).toEqual([recentEvent.id]);
    });
  });
});
