import { Client } from 'pg';

import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';

describe('auth security schema', () => {
  let infra: TestInfra;
  let prisma: ReturnType<typeof ownerPrisma>;
  let counter = 0;

  const user = () => {
    counter += 1;
    return prisma.user.create({ data: { email: `sec${counter}@school.in`, name: `Sec ${counter}` } });
  };

  const device = (userId: string, hash: number) =>
    prisma.knownDevice.create({
      data: {
        userId,
        deviceHash: new Uint8Array(32).fill(hash),
        label: 'Chrome on Windows',
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });

  beforeAll(async () => {
    infra = await startTestInfra();
    prisma = ownerPrisma(infra.env);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await infra?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "users"');
    await prisma.$executeRawUnsafe('DELETE FROM "auth_events"');
  });

  it('leaves the two-factor columns null by default', async () => {
    const u = await user();
    expect(u.totpSecretEnc).toBeNull();
    expect(u.totpEnabledAt).toBeNull();
    expect(u.totpLastStep).toBeNull();
  });

  it('stores the two-factor columns', async () => {
    const u = await user();
    const updated = await prisma.user.update({
      where: { id: u.id },
      data: {
        totpSecretEnc: new Uint8Array([1, 2, 3]),
        totpEnabledAt: new Date(),
        totpLastStep: 58_000_000_000n,
      },
    });
    expect(Buffer.from(updated.totpSecretEnc as Uint8Array)).toEqual(Buffer.from([1, 2, 3]));
    expect(updated.totpLastStep).toBe(58_000_000_000n);
  });

  it('rejects a duplicate recovery code for one user, but not for another', async () => {
    const [a, b] = [await user(), await user()];
    await prisma.recoveryCode.create({ data: { userId: a.id, codeHash: 'h1' } });
    await expect(
      prisma.recoveryCode.create({ data: { userId: a.id, codeHash: 'h1' } }),
    ).rejects.toThrow(/Unique constraint/);
    await prisma.recoveryCode.create({ data: { userId: b.id, codeHash: 'h1' } });
    const row = await prisma.recoveryCode.findFirstOrThrow({ where: { userId: a.id } });
    expect(row.usedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('rejects a duplicate device for one user, but not for another', async () => {
    const [a, b] = [await user(), await user()];
    await device(a.id, 7);
    await expect(device(a.id, 7)).rejects.toThrow(/Unique constraint/);
    await device(b.id, 7);
    await device(a.id, 8);
    const row = await prisma.knownDevice.findFirstOrThrow({ where: { userId: a.id } });
    expect(row.trustedUntil).toBeNull();
  });

  it('deletes recovery codes and devices with their user', async () => {
    const u = await user();
    await prisma.recoveryCode.create({ data: { userId: u.id, codeHash: 'h1' } });
    await device(u.id, 1);
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.recoveryCode.count()).toBe(0);
    expect(await prisma.knownDevice.count()).toBe(0);
  });

  it('accepts the new enum values', async () => {
    const e = await prisma.authEvent.create({
      data: { type: 'RECOVERY_CODE_USED', method: 'RECOVERY_CODE' },
    });
    expect(e.type).toBe('RECOVERY_CODE_USED');
    const u = await user();
    const t = await prisma.tenant.create({
      data: {
        code: 'SECSCH',
        name: 'Sec School',
        board: 'CBSE',
        city: 'Dehradun',
        state: 'UK',
        contactEmail: 'o@school.in',
        termsAcceptedAt: new Date(),
      },
    });
    const m = await prisma.membership.create({
      data: { tenantId: t.id, userId: u.id, role: 'OWNER' },
    });
    const now = new Date();
    const s = await prisma.session.create({
      data: {
        tokenHash: new Uint8Array(32).fill(9),
        userId: u.id,
        tenantId: t.id,
        membershipId: m.id,
        remember: false,
        authenticatedAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
        revokedAt: now,
        revokedReason: 'TWO_FACTOR_DISABLED',
      },
    });
    expect(s.revokedReason).toBe('TWO_FACTOR_DISABLED');
    await prisma.$executeRawUnsafe('DELETE FROM "tenants"');
  });

  it('lets the restricted app role use the new tables', async () => {
    const u = await user();
    const app = new Client({ connectionString: infra.env.DATABASE_URL });
    await app.connect();
    try {
      await app.query(
        `INSERT INTO recovery_codes (id, user_id, code_hash) VALUES (gen_random_uuid(), $1, 'x')`,
        [u.id],
      );
      await app.query(`UPDATE recovery_codes SET used_at = now()`);
      await app.query(
        `INSERT INTO known_devices (id, user_id, device_hash, label, first_seen_at, last_seen_at)
         VALUES (gen_random_uuid(), $1, '\x01', 'Chrome', now(), now())`,
        [u.id],
      );
      await app.query(`UPDATE known_devices SET trusted_until = now()`);
      await app.query('SELECT 1 FROM recovery_codes LIMIT 1');
      await app.query('DELETE FROM known_devices');
      await app.query('DELETE FROM recovery_codes');
    } finally {
      await app.end();
    }
  });
});
