import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';

import { PlatformPrismaService } from '../../src/core/prisma/platform-prisma.service';
import { PrismaService } from '../../src/core/prisma/prisma.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import {
  MAINTENANCE_QUEUE,
  PendingCleanupService,
  PURGE_PENDING_JOB,
} from '../../src/modules/tenancy/pending-cleanup.service';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';

const HOUR = 3_600_000;

describe('pending registration clean-up', () => {
  let infra: TestInfra;
  let app: INestApplication;
  /** Owner-role client for seeding and checking rows across tenants; the app never holds it. */
  let platform: PrismaClient;
  let cleanup: PendingCleanupService;
  const now = new Date();

  async function seedTenant(
    code: string,
    status: 'PENDING_VERIFICATION' | 'ACTIVE',
    ageHours: number,
    userId: string,
  ) {
    return platform.tenant.create({
      data: {
        code,
        name: `School ${code}`,
        board: 'CBSE',
        city: 'Dehradun',
        state: 'UK',
        contactEmail: `admin@${code.toLowerCase()}.in`,
        termsAcceptedAt: now,
        status,
        createdAt: new Date(now.getTime() - ageHours * HOUR),
        campuses: { create: { name: 'Main', isPrimary: true, city: 'Dehradun', state: 'UK' } },
        memberships: { create: { userId, role: 'OWNER' } },
        registrationTokens: {
          create: {
            tokenHash: Buffer.from(code),
            expiresAt: new Date(now.getTime() + HOUR),
          },
        },
      },
    });
  }

  const user = (email: string, verified = false) =>
    platform.user.create({
      data: { email, name: email, emailVerifiedAt: verified ? now : null },
    });

  async function clean() {
    await platform.$executeRawUnsafe('DELETE FROM "tenants"');
    await platform.$executeRawUnsafe('DELETE FROM "users"');
  }

  beforeAll(async () => {
    infra = await startTestInfra();
    // The API runs without the owner credential: the purge goes through a SECURITY DEFINER
    // function that the app role may only execute.
    app = await createApp({ ...infra.env, DATABASE_MIGRATION_URL: undefined }, { logger: false });
    await app.init();
    platform = ownerPrisma(infra.env);
    cleanup = app.get(PendingCleanupService, { strict: false });

    // The app schedules the purge on boot and runs it straight away. Stop the schedule and let
    // that first run finish so it cannot delete rows these tests seed.
    const queue = app.get<Queue>(getQueueToken(MAINTENANCE_QUEUE), { strict: false });
    expect(await queue.getJobSchedulers()).toHaveLength(1);
    await queue.removeJobScheduler(PURGE_PENDING_JOB);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const counts = await queue.getJobCounts('active', 'waiting', 'delayed');
      if ((counts.active ?? 0) + (counts.waiting ?? 0) === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  afterAll(async () => {
    await app?.close();
    await platform?.$disconnect();
    await infra?.stop();
  });

  beforeEach(clean);

  it('deletes a tenant pending for 49 h with its campus, membership and token', async () => {
    const u = await user('a@x.in');
    const t = await seedTenant('OLDS', 'PENDING_VERIFICATION', 49, u.id);

    const result = await cleanup.purgeExpired(now);

    expect(result).toEqual({ tenants: 1, users: 1 });
    expect(await platform.tenant.count({ where: { id: t.id } })).toBe(0);
    expect(await platform.campus.count({ where: { tenantId: t.id } })).toBe(0);
    expect(await platform.membership.count({ where: { tenantId: t.id } })).toBe(0);
    expect(await platform.registrationToken.count({ where: { tenantId: t.id } })).toBe(0);
    expect(await platform.user.count({ where: { id: u.id } })).toBe(0);
    // The code is free again.
    expect(await platform.tenant.count({ where: { code: 'OLDS' } })).toBe(0);
  });

  it('keeps a tenant pending for 47 h', async () => {
    const u = await user('b@x.in');
    const t = await seedTenant('NEWS', 'PENDING_VERIFICATION', 47, u.id);

    expect(await cleanup.purgeExpired(now)).toEqual({ tenants: 0, users: 0 });
    expect(await platform.tenant.count({ where: { id: t.id } })).toBe(1);
    expect(await platform.user.count({ where: { id: u.id } })).toBe(1);
  });

  it('keeps an ACTIVE tenant however old', async () => {
    const u = await user('c@x.in', true);
    const t = await seedTenant('ACTV', 'ACTIVE', 500, u.id);

    expect(await cleanup.purgeExpired(now)).toEqual({ tenants: 0, users: 0 });
    expect(await platform.tenant.count({ where: { id: t.id } })).toBe(1);
  });

  it('keeps a user who also belongs to an active school, and their membership', async () => {
    const u = await user('d@x.in'); // unverified email, but belongs to an active school
    const active = await seedTenant('LIVE', 'ACTIVE', 100, u.id);
    const pending = await seedTenant('STAL', 'PENDING_VERIFICATION', 60, u.id);

    expect(await cleanup.purgeExpired(now)).toEqual({ tenants: 1, users: 0 });
    expect(await platform.tenant.count({ where: { id: pending.id } })).toBe(0);
    expect(await platform.user.count({ where: { id: u.id } })).toBe(1);
    expect(await platform.membership.count({ where: { tenantId: active.id, userId: u.id } })).toBe(
      1,
    );
  });

  it('keeps an orphan user whose email is verified', async () => {
    const u = await user('e@x.in', true);
    const t = await seedTenant('VERF', 'PENDING_VERIFICATION', 60, u.id);

    expect(await cleanup.purgeExpired(now)).toEqual({ tenants: 1, users: 0 });
    expect(await platform.tenant.count({ where: { id: t.id } })).toBe(0);
    expect(await platform.user.count({ where: { id: u.id } })).toBe(1);
  });

  it('is idempotent: the second run purges nothing', async () => {
    const u = await user('f@x.in');
    await seedTenant('TWCE', 'PENDING_VERIFICATION', 49, u.id);

    expect(await cleanup.purgeExpired(now)).toEqual({ tenants: 1, users: 1 });
    expect(await cleanup.purgeExpired(now)).toEqual({ tenants: 0, users: 0 });
  });

  it('boots and serves without the owner database URL', async () => {
    const res = await request(app.getHttpServer() as App).get('/health');
    expect(res.status).toBe(200);
  });

  it('gives the API no owner-role client', () => {
    expect(() => app.get(PlatformPrismaService, { strict: false })).toThrow();
  });

  it('purges as the app role through an execute-only SECURITY DEFINER function', async () => {
    const prisma = app.get(PrismaService);
    const [who] = await prisma.$queryRaw<{ current_user: string }[]>`SELECT current_user`;
    expect(who?.current_user).toBe('classloom_app');

    const admin = new Client({ connectionString: infra.postgres.getConnectionUri() });
    await admin.connect();
    try {
      await admin.query('CREATE ROLE stranger NOLOGIN');
      const res = await admin.query<{ app: boolean; stranger: boolean; definer: boolean }>(
        `SELECT has_function_privilege('classloom_app', p.oid, 'EXECUTE') AS app,
                has_function_privilege('stranger', p.oid, 'EXECUTE') AS stranger,
                p.prosecdef AS definer
           FROM pg_proc p WHERE p.proname = 'purge_pending_registrations'`,
      );
      expect(res.rows).toEqual([{ app: true, stranger: false, definer: true }]);
    } finally {
      await admin.query('DROP ROLE IF EXISTS stranger');
      await admin.end();
    }
  });
});
