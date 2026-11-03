import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { Client } from 'pg';

import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';

const migrationsDir = path.resolve(__dirname, '../../prisma/migrations');

async function authMigrationSql(): Promise<string> {
  const dirs = (await readdir(migrationsDir)).filter((d) => d.endsWith('_auth'));
  if (dirs.length !== 1) throw new Error(`expected one *_auth migration, found ${dirs.length}`);
  return readFile(path.join(migrationsDir, dirs[0] as string, 'migration.sql'), 'utf8');
}

describe('auth schema', () => {
  let infra: TestInfra;
  let prisma: ReturnType<typeof ownerPrisma>;
  let counter = 0;

  const user = (mobile: string | null) => {
    counter += 1;
    return prisma.user.create({
      data: { email: `user${counter}@school.in`, name: `User ${counter}`, mobile },
    });
  };

  const tenant = () => {
    counter += 1;
    return prisma.tenant.create({
      data: {
        code: `SCH${counter}`,
        name: `School ${counter}`,
        board: 'CBSE',
        city: 'Dehradun',
        state: 'UK',
        contactEmail: `owner${counter}@school.in`,
        termsAcceptedAt: new Date(),
      },
    });
  };

  /** A user with a membership in a new tenant, and a session for them. */
  async function seedSession() {
    const [u, t] = [await user(null), await tenant()];
    const membership = await prisma.membership.create({
      data: { tenantId: t.id, userId: u.id },
    });
    const now = new Date();
    const session = await prisma.session.create({
      data: {
        tokenHash: new Uint8Array(32).map(() => Math.floor(Math.random() * 256)),
        userId: u.id,
        tenantId: t.id,
        membershipId: membership.id,
        remember: false,
        authenticatedAt: now,
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + 7_200_000),
        expiresAt: new Date(now.getTime() + 43_200_000),
        ip: '203.0.113.7',
        userAgent: 'vitest',
      },
    });
    return { u, t, membership, session };
  }

  beforeAll(async () => {
    infra = await startTestInfra();
    prisma = ownerPrisma(infra.env);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await infra?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "tenants"');
    await prisma.$executeRawUnsafe('DELETE FROM "users"');
    await prisma.$executeRawUnsafe('DELETE FROM "auth_events"');
  });

  it('rejects two users with the same mobile', async () => {
    await user('+919876543210');
    await expect(user('+919876543210')).rejects.toThrow(/users_mobile_key/);
  });

  it('allows any number of users without a mobile', async () => {
    await user(null);
    await user(null);
    await user('+919876543211');
    expect(await prisma.user.count()).toBe(3);
  });

  it('stores the password columns as null by default', async () => {
    const u = await user(null);
    expect(u.passwordHash).toBeNull();
    expect(u.passwordChangedAt).toBeNull();
  });

  it('deletes sessions with their user, and nulls the user on auth events', async () => {
    const { u, t, session } = await seedSession();
    const event = await prisma.authEvent.create({
      data: {
        type: 'SIGN_IN_SUCCEEDED',
        method: 'PASSWORD',
        userId: u.id,
        tenantId: t.id,
        sessionId: session.id,
        ip: '203.0.113.7',
      },
    });

    await prisma.user.delete({ where: { id: u.id } });

    expect(await prisma.session.count()).toBe(0);
    const after = await prisma.authEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.userId).toBeNull();
    expect(after.sessionId).toBeNull();
    expect(after.tenantId).toBe(t.id);
  });

  it('deletes sessions with their tenant, and nulls the tenant on auth events', async () => {
    const { u, t, session } = await seedSession();
    const event = await prisma.authEvent.create({
      data: { type: 'SIGNED_OUT', userId: u.id, tenantId: t.id, sessionId: session.id },
    });

    await prisma.tenant.delete({ where: { id: t.id } });

    expect(await prisma.session.count()).toBe(0);
    const after = await prisma.authEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.tenantId).toBeNull();
    expect(after.userId).toBe(u.id);
  });

  it('keeps the auth event when only its session is deleted', async () => {
    const { u, session } = await seedSession();
    const event = await prisma.authEvent.create({
      data: { type: 'SIGNED_OUT', userId: u.id, sessionId: session.id },
    });
    await prisma.session.delete({ where: { id: session.id } });
    const after = await prisma.authEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.sessionId).toBeNull();
  });

  it('accepts events that match nobody', async () => {
    const event = await prisma.authEvent.create({ data: { type: 'SIGN_IN_FAILED' } });
    expect(event.userId).toBeNull();
    expect(event.method).toBeNull();
  });

  it('lets the restricted app role use the new tables', async () => {
    const app = new Client({ connectionString: infra.env.DATABASE_URL });
    await app.connect();
    try {
      await app.query(
        `INSERT INTO auth_events (id, type) VALUES (gen_random_uuid(), 'SIGNED_OUT')`,
      );
      const events = await app.query('SELECT count(*)::int AS n FROM auth_events');
      expect(events.rows[0]).toEqual({ n: 1 });
      await app.query('SELECT 1 FROM sessions LIMIT 1');
      await app.query('DELETE FROM sessions');
      await app.query('DELETE FROM auth_events');
    } finally {
      await app.end();
    }
  });
});

describe('auth migration de-duplication', () => {
  let infra: TestInfra;
  let owner: Client;

  beforeAll(async () => {
    infra = await startTestInfra();
    owner = new Client({ connectionString: infra.env.DATABASE_MIGRATION_URL });
    await owner.connect();
  });

  afterAll(async () => {
    await owner?.end();
    await infra?.stop();
  });

  it('keeps a shared mobile on the oldest user only', async () => {
    const sql = await authMigrationSql();
    const start = sql.indexOf('-- dedupe:start');
    const end = sql.indexOf('-- dedupe:end');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const dedupe = sql.slice(start, end);

    await owner.query('DROP INDEX users_mobile_key');
    try {
      const ids = [
        '00000000-0000-7000-8000-000000000002',
        '00000000-0000-7000-8000-000000000001',
        '00000000-0000-7000-8000-000000000003',
      ];
      // Oldest by created_at is ids[1]; ids[0] and ids[2] share a timestamp, so the id breaks the tie.
      const created = ['2026-01-02', '2026-01-01', '2026-01-02'];
      for (const [i, id] of ids.entries()) {
        await owner.query(
          `INSERT INTO users (id, email, name, mobile, created_at, updated_at)
           VALUES ($1, $2, 'U', '+919000000000', $3, now())`,
          [id, `dup${i}@school.in`, created[i]],
        );
      }
      await owner.query(
        `INSERT INTO users (id, email, name, mobile, updated_at)
         VALUES (gen_random_uuid(), 'solo@school.in', 'Solo', '+919000000001', now())`,
      );

      await owner.query(dedupe);

      const res = await owner.query<{ id: string; mobile: string | null }>(
        `SELECT id, mobile FROM users WHERE email LIKE 'dup%' ORDER BY created_at, id`,
      );
      expect(res.rows).toEqual([
        { id: ids[1], mobile: '+919000000000' },
        { id: ids[0], mobile: null },
        { id: ids[2], mobile: null },
      ]);
      const solo = await owner.query(`SELECT mobile FROM users WHERE email = 'solo@school.in'`);
      expect(solo.rows[0]).toEqual({ mobile: '+919000000001' });
    } finally {
      await owner.query('DELETE FROM users');
      await owner.query(
        'CREATE UNIQUE INDEX users_mobile_key ON users (mobile) WHERE mobile IS NOT NULL',
      );
    }
  });
});
