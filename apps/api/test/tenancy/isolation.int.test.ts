import { Client } from 'pg';

import { PrismaService } from '../../src/core/prisma/prisma.service';
import { TenantContextMissingError, TenantReassignmentError } from '../../src/core/tenancy/errors';
import { TenantContext } from '../../src/core/tenancy/tenant-context';
import { withTenant } from '../../src/core/tenancy/with-tenant';
import { startTestInfra, type TestInfra } from '../setup-containers';

const A = '0192d5e0-0000-7000-8000-00000000000a';
const B = '0192d5e0-0000-7000-8000-00000000000b';

describe('tenant data isolation', () => {
  let infra: TestInfra;
  let ctx: TenantContext;
  let prisma: PrismaService;
  let owner: Client;
  let app: Client;
  let campusB: string;

  async function seedTenant(id: string, code: string): Promise<string> {
    await prisma.tenant.create({
      data: {
        id,
        code,
        name: `School ${code}`,
        board: 'CBSE',
        city: 'Dehradun',
        state: 'UK',
        contactEmail: `admin@${code.toLowerCase()}.in`,
        termsAcceptedAt: new Date(),
      },
    });
    const campus = await withTenant(prisma, id, (tx) =>
      tx.campus.create({
        data: {
          tenantId: id,
          name: `School ${code}`,
          isPrimary: true,
          city: 'Dehradun',
          state: 'UK',
        },
      }),
    );
    return campus.id;
  }

  async function campusNameAsOwner(id: string): Promise<string | undefined> {
    const res = await owner.query<{ name: string }>('SELECT name FROM campuses WHERE id = $1', [
      id,
    ]);
    return res.rows[0]?.name;
  }

  beforeAll(async () => {
    infra = await startTestInfra();
    ctx = new TenantContext();
    prisma = new PrismaService(infra.env, ctx);
    owner = new Client({ connectionString: infra.env.DATABASE_MIGRATION_URL });
    app = new Client({ connectionString: infra.env.DATABASE_URL });
    await Promise.all([owner.connect(), app.connect()]);
  });

  beforeEach(async () => {
    await owner.query('TRUNCATE tenants, users CASCADE');
    await seedTenant(A, 'SCHOOLA');
    campusB = await seedTenant(B, 'SCHOOLB');
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await prisma?.$disconnect();
    await infra?.stop();
  });

  describe('scoped client', () => {
    it("returns only the current tenant's campuses", async () => {
      const campuses = await ctx.run(A, () => prisma.scoped.campus.findMany());
      expect(campuses).toHaveLength(1);
      expect(campuses[0]?.tenantId).toBe(A);
    });

    it("updateMany in A's context leaves B's rows unchanged", async () => {
      const res = await ctx.run(A, () => prisma.scoped.campus.updateMany({ data: { name: 'x' } }));
      expect(res.count).toBe(1);
      expect(await campusNameAsOwner(campusB)).toBe('School SCHOOLB');
    });

    it("deleteMany in A's context deletes none of B's rows", async () => {
      const res = await ctx.run(A, () => prisma.scoped.campus.deleteMany());
      expect(res.count).toBe(1);
      expect(await campusNameAsOwner(campusB)).toBe('School SCHOOLB');
    });

    it("cannot read B's campus by id from A's context", async () => {
      const found = await ctx.run(A, () =>
        prisma.scoped.campus.findUnique({ where: { id: campusB } }),
      );
      expect(found).toBeNull();
    });

    it('sets tenantId on create from the context', async () => {
      const user = await prisma.user.create({ data: { email: 'asha@school.in', name: 'Asha' } });
      const membership = await ctx.run(B, () =>
        prisma.scoped.membership.create({
          data: { userId: user.id, role: 'OWNER' } as never,
        }),
      );
      expect(membership.tenantId).toBe(B);
    });

    it("cannot move A's campus to B through update", async () => {
      const campusA = await withTenant(prisma, A, (tx) => tx.campus.findFirstOrThrow());
      await expect(
        ctx.run(A, () =>
          prisma.scoped.campus.update({ where: { id: campusA.id }, data: { tenantId: B } }),
        ),
      ).rejects.toThrow(TenantReassignmentError);
      const after = await withTenant(prisma, A, (tx) =>
        tx.campus.findUnique({ where: { id: campusA.id } }),
      );
      expect(after?.tenantId).toBe(A);
    });

    it('rejects without a tenant context', async () => {
      await expect(prisma.scoped.campus.findMany()).rejects.toThrow(TenantContextMissingError);
    });

    it('allows only one primary campus per tenant', async () => {
      await expect(
        ctx.run(A, () =>
          prisma.scoped.campus.create({
            data: { name: 'Second', isPrimary: true, city: 'Dehradun', state: 'UK' } as never,
          }),
        ),
      ).rejects.toThrow(/Unique constraint/);
    });
  });

  describe('withTenant', () => {
    it('cannot insert a row for another tenant (RLS WITH CHECK)', async () => {
      await expect(
        withTenant(prisma, A, (tx) =>
          tx.campus.create({
            data: { tenantId: B, name: 'Sneaky', isPrimary: false, city: 'Dehradun', state: 'UK' },
          }),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe('row-level security for the app role (raw SQL)', () => {
    it("hides B's rows and rejects inserts for B inside A's transaction", async () => {
      await app.query('BEGIN');
      try {
        await app.query("SELECT set_config('app.tenant_id', $1, true)", [A]);
        const res = await app.query<{ count: string }>(
          'SELECT count(*) FROM campuses WHERE tenant_id = $1',
          [B],
        );
        expect(res.rows[0]?.count).toBe('0');
        await expect(
          app.query(
            `INSERT INTO campuses (id, tenant_id, name, is_primary, city, state, status, updated_at)
             VALUES (gen_random_uuid(), $1, 'Sneaky', false, 'Dehradun', 'UK', 'ACTIVE', now())`,
            [B],
          ),
        ).rejects.toThrow(/row-level security/);
      } finally {
        await app.query('ROLLBACK');
      }
    });

    it('sees no campuses without app.tenant_id', async () => {
      const res = await app.query<{ count: string }>('SELECT count(*) FROM campuses');
      expect(res.rows[0]?.count).toBe('0');
    });

    it('sees no memberships without app.tenant_id', async () => {
      const res = await app.query<{ count: string }>('SELECT count(*) FROM memberships');
      expect(res.rows[0]?.count).toBe('0');
    });

    it('drops the transaction-local tenant at commit on the same connection', async () => {
      await app.query('BEGIN');
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [A]);
      await app.query('COMMIT');
      const res = await app.query<{ t: string | null }>(
        "SELECT current_setting('app.tenant_id', true) AS t",
      );
      expect(res.rows[0]?.t ?? '').toBe('');
      const count = await app.query<{ count: string }>('SELECT count(*) FROM campuses');
      expect(count.rows[0]?.count).toBe('0');
    });
  });

  describe('pooled connections do not leak the tenant (Review Focus 1)', () => {
    it('leaves no tenant set after a scoped query', async () => {
      for (let i = 0; i < 5; i++) {
        await ctx.run(A, () => prisma.scoped.campus.findMany());
        const [setting] = await prisma.$queryRaw<{ t: string | null }[]>`
          SELECT current_setting('app.tenant_id', true) AS t`;
        expect(setting?.t ?? '').toBe('');
        const [count] = await prisma.$queryRaw<{ count: bigint }[]>`
          SELECT count(*) AS count FROM campuses`;
        expect(count?.count).toBe(0n);
      }
    });
  });
});
