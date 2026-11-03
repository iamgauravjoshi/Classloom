import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BUILT_IN_ROLE_DEFAULTS, BUILT_IN_ROLE_KEYS } from '@classloom/contracts';
import { Client } from 'pg';

import { applyMigrations, startTestInfra, type TestInfra } from '../setup-containers';

const apiDir = path.resolve(__dirname, '../..');
const migrationsDir = path.join(apiDir, 'prisma/migrations');

/**
 * A Prisma config whose migrations folder holds every migration before the IAM one, so the test
 * can seed a database at the pre-IAM schema (Part 2b) and then apply the IAM migration to it.
 */
async function preIamConfig(): Promise<{ dir: string; config: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'classloom-pre-iam-'));
  const target = path.join(dir, 'migrations');
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  for (const entry of entries) {
    // The IAM migration and every later one are applied by the test itself.
    if (entry.isDirectory() && entry.name >= '20261102100000_iam') continue;
    await cp(path.join(migrationsDir, entry.name), path.join(target, entry.name), {
      recursive: true,
    });
  }
  const config = path.join(dir, 'prisma.config.mjs');
  await writeFile(
    config,
    `export default ${JSON.stringify({
      schema: path.join(apiDir, 'prisma/schema'),
      migrations: { path: target },
      datasource: { url: '' },
    })};\n`.replace('"url":""', '"url":process.env.DATABASE_MIGRATION_URL'),
  );
  return { dir, config };
}

const A = randomUUID();
const B = randomUUID();
const OWNER_A = randomUUID();
const OWNER_B = randomUUID();
const SECOND_A = randomUUID();
const MEMBERSHIP_A = randomUUID();
const MEMBERSHIP_B = randomUUID();
const REVOKED_A = randomUUID();

const sha = (s: string) => createHash('sha256').update(s).digest();

describe('IAM schema and migration', () => {
  let infra: TestInfra;
  let tmp: string;
  let owner: Client;
  let app: Client;

  /** Runs `fn` as the app role inside a transaction scoped to `tenantId`, then rolls back. */
  async function asApp<T>(tenantId: string | null, fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      if (tenantId) await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }

  async function seedPreIam(c: Client) {
    for (const [id, code] of [
      [A, 'IAMA'],
      [B, 'IAMB'],
    ] as const) {
      await c.query(
        `INSERT INTO tenants (id, code, name, board, city, state, contact_email, status,
                              verified_at, terms_accepted_at, updated_at)
         VALUES ($1, $2, $3, 'CBSE', 'Dehradun', 'UK', $4, 'ACTIVE', now(), now(), now())`,
        [id, code, `School ${code}`, `admin@${code.toLowerCase()}.in`],
      );
      await c.query(
        `INSERT INTO campuses (id, tenant_id, name, is_primary, city, state, updated_at)
         VALUES ($1, $2, 'Main', true, 'Dehradun', 'UK', now())`,
        [randomUUID(), id],
      );
    }
    for (const [id, email] of [
      [OWNER_A, 'owner@iama.in'],
      [OWNER_B, 'owner@iamb.in'],
      [SECOND_A, 'second@iama.in'],
    ] as const) {
      await c.query(
        `INSERT INTO users (id, email, name, email_verified_at, updated_at)
         VALUES ($1, $2, $3, now(), now())`,
        [id, email, email],
      );
    }
    for (const [id, tenant, user, status] of [
      [MEMBERSHIP_A, A, OWNER_A, 'ACTIVE'],
      [MEMBERSHIP_B, B, OWNER_B, 'ACTIVE'],
      [REVOKED_A, A, SECOND_A, 'REVOKED'],
    ] as const) {
      await c.query(
        `INSERT INTO memberships (id, tenant_id, user_id, role, status, updated_at)
         VALUES ($1, $2, $3, 'OWNER', $4, now())`,
        [id, tenant, user, status],
      );
    }
  }

  beforeAll(async () => {
    const pre = await preIamConfig();
    tmp = pre.dir;
    infra = await startTestInfra({ prismaConfig: pre.config });
    const seeder = new Client({ connectionString: infra.env.DATABASE_MIGRATION_URL });
    await seeder.connect();
    try {
      await seedPreIam(seeder);
    } finally {
      await seeder.end();
    }
    await applyMigrations(infra.env.DATABASE_MIGRATION_URL as string);

    owner = new Client({ connectionString: infra.env.DATABASE_MIGRATION_URL });
    app = new Client({ connectionString: infra.env.DATABASE_URL });
    await Promise.all([owner.connect(), app.connect()]);

    // One invitation and one audit event per school, seeded as the owner.
    for (const [tenant, inviter, label] of [
      [A, OWNER_A, 'a'],
      [B, OWNER_B, 'b'],
    ] as const) {
      const role = await owner.query<{ id: string }>(
        `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'TEACHER'`,
        [tenant],
      );
      await owner.query(
        `INSERT INTO invitations (id, tenant_id, email, name, role_ids, token_hash, expires_at,
                                  invited_by, updated_at)
         VALUES ($1, $2, $3, 'Invited Person', ARRAY[$4::uuid], $5, now() + interval '7 days',
                 $6, now())`,
        [randomUUID(), tenant, `invitee-${label}@school.in`, role.rows[0]!.id, sha(label), inviter],
      );
      await owner.query(
        `INSERT INTO audit_events (id, tenant_id, actor_user_id, action, target_type, target_id)
         VALUES ($1, $2, $3, 'role.updated', 'role', $4)`,
        [randomUUID(), tenant, inviter, role.rows[0]!.id],
      );
    }
  });

  afterAll(async () => {
    await Promise.allSettled([owner?.end(), app?.end()]);
    await infra?.stop();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  describe('migrating a school that existed before IAM', () => {
    it.each([A, B])('seeds the nine built-in roles with the contract defaults', async (tenant) => {
      const roles = await owner.query<{
        id: string;
        key: string | null;
        name: string;
        description: string | null;
        requires_two_factor: boolean;
      }>(`SELECT id, key, name, description, requires_two_factor FROM roles WHERE tenant_id = $1`, [
        tenant,
      ]);
      expect(roles.rows.map((r) => r.key).sort()).toEqual([...BUILT_IN_ROLE_KEYS].sort());

      for (const key of BUILT_IN_ROLE_KEYS) {
        const defaults = BUILT_IN_ROLE_DEFAULTS[key];
        const role = roles.rows.find((r) => r.key === key)!;
        expect({
          name: role.name,
          description: role.description,
          requiresTwoFactor: role.requires_two_factor,
        }).toEqual({
          name: defaults.name,
          description: defaults.description,
          requiresTwoFactor: defaults.requiresTwoFactor,
        });
        const perms = await owner.query<{ permission: string; tenant_id: string }>(
          `SELECT permission, tenant_id FROM role_permissions WHERE role_id = $1`,
          [role.id],
        );
        const expected = defaults.permissions === 'ALL' ? [] : [...defaults.permissions];
        expect(perms.rows.map((p) => p.permission).sort()).toEqual(expected.sort());
        expect(perms.rows.every((p) => p.tenant_id === tenant)).toBe(true);
      }
    });

    it('gives the Owner role no permission rows (it means all)', async () => {
      const res = await owner.query<{ n: string }>(
        `SELECT count(*) AS n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
          WHERE r.key = 'OWNER'`,
      );
      expect(Number(res.rows[0]!.n)).toBe(0);
    });

    it('moves every existing owner membership onto the Owner role', async () => {
      const res = await owner.query<{ membership_id: string; key: string; tenant_id: string }>(
        `SELECT mr.membership_id, r.key, mr.tenant_id
           FROM membership_roles mr JOIN roles r ON r.id = mr.role_id
          ORDER BY mr.membership_id`,
      );
      expect(res.rows).toHaveLength(3);
      expect(res.rows).toEqual(
        expect.arrayContaining([
          { membership_id: MEMBERSHIP_A, key: 'OWNER', tenant_id: A },
          { membership_id: MEMBERSHIP_B, key: 'OWNER', tenant_id: B },
          { membership_id: REVOKED_A, key: 'OWNER', tenant_id: A },
        ]),
      );
    });

    it('keeps membership statuses and drops the role column and its enum', async () => {
      const statuses = await owner.query<{ id: string; status: string; deactivated_at: null }>(
        `SELECT id, status, deactivated_at FROM memberships ORDER BY id`,
      );
      expect(statuses.rows).toEqual(
        expect.arrayContaining([
          { id: MEMBERSHIP_A, status: 'ACTIVE', deactivated_at: null },
          { id: REVOKED_A, status: 'REVOKED', deactivated_at: null },
        ]),
      );
      const column = await owner.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'memberships' AND column_name = 'role'`,
      );
      expect(column.rowCount).toBe(0);
      const type = await owner.query(`SELECT 1 FROM pg_type WHERE typname = 'MembershipRole'`);
      expect(type.rowCount).toBe(0);
    });

    it('adds the new enum values and the setup-required session flag', async () => {
      const values = await owner.query<{ typname: string; enumlabel: string }>(
        `SELECT t.typname, e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname IN ('MembershipStatus', 'AuthMethod', 'SessionRevokedReason')`,
      );
      const labels = values.rows.map((v) => `${v.typname}.${v.enumlabel}`);
      expect(labels).toEqual(
        expect.arrayContaining([
          'MembershipStatus.DEACTIVATED',
          'AuthMethod.INVITE',
          'SessionRevokedReason.MEMBER_DEACTIVATED',
        ]),
      );
      const column = await owner.query<{ column_default: string; is_nullable: string }>(
        `SELECT column_default, is_nullable FROM information_schema.columns
          WHERE table_name = 'sessions' AND column_name = 'two_factor_setup_required'`,
      );
      expect(column.rows[0]).toEqual({ column_default: 'false', is_nullable: 'NO' });
    });
  });

  describe('seed_builtin_roles', () => {
    it('seeds a new school when called by the app role inside its tenant context', async () => {
      const tenant = randomUUID();
      await owner.query(
        `INSERT INTO tenants (id, code, name, board, city, state, contact_email,
                              terms_accepted_at, updated_at)
         VALUES ($1, 'IAMC', 'School IAMC', 'CBSE', 'Dehradun', 'UK', 'a@iamc.in', now(), now())`,
        [tenant],
      );
      try {
        const count = await asApp(tenant, async () => {
          await app.query('SELECT seed_builtin_roles($1)', [tenant]);
          const roles = await app.query('SELECT 1 FROM roles');
          const perms = await app.query('SELECT 1 FROM role_permissions');
          return { roles: roles.rowCount, perms: perms.rowCount };
        });
        const expectedPerms = BUILT_IN_ROLE_KEYS.reduce((sum, key) => {
          const p = BUILT_IN_ROLE_DEFAULTS[key].permissions;
          return sum + (p === 'ALL' ? 0 : p.length);
        }, 0);
        expect(count).toEqual({ roles: 9, perms: expectedPerms });
      } finally {
        await owner.query('DELETE FROM tenants WHERE id = $1', [tenant]);
      }
    });

    it("cannot seed another school's roles from the app role", async () => {
      await expect(asApp(A, () => app.query('SELECT seed_builtin_roles($1)', [B]))).rejects.toThrow(
        /row-level security/,
      );
    });
  });

  describe('row-level security', () => {
    const tables = ['roles', 'role_permissions', 'membership_roles', 'invitations', 'audit_events'];

    it.each(tables)("hides another school's %s from the app role", async (table) => {
      const rows = await asApp(A, async () => {
        const res = await app.query<{ tenant_id: string }>(`SELECT tenant_id FROM ${table}`);
        return res.rows;
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenant_id === A)).toBe(true);
    });

    it.each(tables)('shows the app role no %s without a tenant context', async (table) => {
      const res = await asApp(null, () => app.query(`SELECT 1 FROM ${table}`));
      expect(res.rowCount).toBe(0);
    });

    it.each(tables)('enables and forces row-level security on %s', async (table) => {
      const res = await owner.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
        [table],
      );
      expect(res.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    });

    const rolesOf = async (tenant: string) =>
      (
        await owner.query<{ id: string; key: string }>(
          `SELECT id, key FROM roles WHERE tenant_id = $1`,
          [tenant],
        )
      ).rows;

    it("refuses writes carrying another school's tenant_id", async () => {
      const teacherB = (await rolesOf(B)).find((r) => r.key === 'TEACHER')!.id;
      const writes: [string, unknown[]][] = [
        [
          `INSERT INTO roles (id, tenant_id, name, requires_two_factor, updated_at)
           VALUES ($1, $2, 'Sneaky', false, now())`,
          [randomUUID(), B],
        ],
        [
          `INSERT INTO role_permissions (role_id, tenant_id, permission)
           VALUES ($1, $2, 'iam.manage')`,
          [teacherB, B],
        ],
        [
          `INSERT INTO membership_roles (membership_id, role_id, tenant_id)
           VALUES ($1, $2, $3)`,
          [MEMBERSHIP_B, teacherB, B],
        ],
        [
          `INSERT INTO invitations (id, tenant_id, email, name, role_ids, token_hash, expires_at,
                                    invited_by, updated_at)
           VALUES ($1, $2, 'x@school.in', 'Xavier', ARRAY[$3::uuid], $4, now(), $5, now())`,
          [randomUUID(), B, teacherB, sha('sneaky'), OWNER_A],
        ],
        [
          `INSERT INTO audit_events (id, tenant_id, action, target_type, target_id)
           VALUES ($1, $2, 'role.created', 'role', $3)`,
          [randomUUID(), B, teacherB],
        ],
      ];
      for (const [sql, params] of writes) {
        await expect(asApp(A, () => app.query(sql, params))).rejects.toThrow(/row-level security/);
      }
    });

    it("refuses to link a membership to another school's role", async () => {
      const teacherB = (await rolesOf(B)).find((r) => r.key === 'TEACHER')!.id;
      await expect(
        asApp(A, () =>
          app.query(
            `INSERT INTO membership_roles (membership_id, role_id, tenant_id) VALUES ($1, $2, $3)`,
            [MEMBERSHIP_A, teacherB, A],
          ),
        ),
      ).rejects.toThrow(/foreign key/);
    });

    it('lets the app role write its own school rows', async () => {
      const teacherA = (await rolesOf(A)).find((r) => r.key === 'TEACHER')!.id;
      await asApp(A, async () => {
        await app.query(
          `INSERT INTO membership_roles (membership_id, role_id, tenant_id, assigned_by)
           VALUES ($1, $2, $3, $4)`,
          [MEMBERSHIP_A, teacherA, A, OWNER_A],
        );
        await app.query(
          `INSERT INTO role_permissions (role_id, tenant_id, permission)
           VALUES ($1, $2, 'fees.view')`,
          [teacherA, A],
        );
      });
    });
  });

  describe('roles', () => {
    it('keeps role names unique per school, ignoring case', async () => {
      await expect(
        owner.query(
          `INSERT INTO roles (id, tenant_id, name, requires_two_factor, updated_at)
           VALUES ($1, $2, 'teacher', false, now())`,
          [randomUUID(), A],
        ),
      ).rejects.toThrow(/unique/);
    });

    it('allows any number of custom roles (null key) per school', async () => {
      await owner.query('BEGIN');
      try {
        for (const name of ['Custom One', 'Custom Two']) {
          await owner.query(
            `INSERT INTO roles (id, tenant_id, name, requires_two_factor, updated_at)
             VALUES ($1, $2, $3, false, now())`,
            [randomUUID(), A, name],
          );
        }
      } finally {
        await owner.query('ROLLBACK');
      }
    });

    it('refuses to delete a role that is still assigned', async () => {
      const ownerRole = await owner.query<{ id: string }>(
        `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'OWNER'`,
        [A],
      );
      await expect(
        owner.query('DELETE FROM roles WHERE id = $1', [ownerRole.rows[0]!.id]),
      ).rejects.toThrow(/foreign key/);
    });
  });

  describe('audit events', () => {
    it('lets the app role insert and read its audit events', async () => {
      const rows = await asApp(A, async () => {
        await app.query(
          `INSERT INTO audit_events (id, tenant_id, actor_user_id, action, target_type, target_id,
                                     before, after, ip, user_agent)
           VALUES ($1, $2, $3, 'member.roles_changed', 'membership', $4, $5, $6,
                   '198.51.100.7', 'test')`,
          [
            randomUUID(),
            A,
            OWNER_A,
            MEMBERSHIP_A,
            JSON.stringify({ roleIds: [] }),
            JSON.stringify({ roleIds: ['x'] }),
          ],
        );
        return (await app.query('SELECT 1 FROM audit_events')).rowCount;
      });
      expect(rows).toBe(2);
    });

    it('refuses UPDATE and DELETE on audit events for the app role', async () => {
      await expect(
        asApp(A, () => app.query(`UPDATE audit_events SET action = 'role.deleted'`)),
      ).rejects.toThrow(/permission denied/);
      await expect(asApp(A, () => app.query('DELETE FROM audit_events'))).rejects.toThrow(
        /permission denied/,
      );
      await expect(asApp(A, () => app.query('TRUNCATE audit_events'))).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  describe('invitation_by_token', () => {
    it('returns the id and school for a known hash with no tenant context', async () => {
      const expected = await owner.query<{ id: string }>(
        `SELECT id FROM invitations WHERE token_hash = $1`,
        [sha('b')],
      );
      const res = await asApp(null, () =>
        app.query<{ id: string; tenant_id: string }>('SELECT * FROM invitation_by_token($1)', [
          sha('b'),
        ]),
      );
      expect(res.rows).toEqual([{ id: expected.rows[0]!.id, tenant_id: B }]);
    });

    it('returns nothing for an unknown hash', async () => {
      const res = await asApp(null, () =>
        app.query('SELECT * FROM invitation_by_token($1)', [sha('nobody')]),
      );
      expect(res.rowCount).toBe(0);
    });

    it('is executable by the app role only, not by PUBLIC', async () => {
      const res = await owner.query<{ grantee: string }>(
        `SELECT grantee FROM information_schema.routine_privileges
          WHERE routine_name = 'invitation_by_token' AND privilege_type = 'EXECUTE'`,
      );
      expect(res.rows.map((r) => r.grantee).sort()).toEqual(['classloom_app', 'classloom_owner']);
    });
  });
});
