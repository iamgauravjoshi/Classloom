import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DEFAULT_SERIES, NUMBER_SERIES_KEYS } from '@classloom/contracts';
import { Client } from 'pg';

import { applyMigrations, startTestInfra, type TestInfra } from '../setup-containers';

const apiDir = path.resolve(__dirname, '../..');
const migrationsDir = path.join(apiDir, 'prisma/migrations');
const SETTINGS_MIGRATION = '20261106100000_settings_6a';

/**
 * A Prisma config whose migrations folder holds every migration before the Part 6a one, so the
 * test can seed a database at the Part 5 schema and then apply the settings migration to it.
 */
async function preSettingsConfig(): Promise<{ dir: string; config: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'classloom-pre-settings-'));
  const target = path.join(dir, 'migrations');
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name >= SETTINGS_MIGRATION) continue;
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

/** Matches a pg error by its SQLSTATE (23505 unique, 23514 check, 23503 foreign key, ...). */
const pgCode = (code: string): unknown => expect.objectContaining({ code }) as unknown;

async function insert(c: Client, table: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row);
  await c.query(
    `INSERT INTO ${table} (${cols.join(', ')})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(row),
  );
}

const NEW_TABLES = ['number_series', 'number_series_counters'];

const A = randomUUID();
const B = randomUUID();
const YEAR_A = randomUUID();
const YEAR_B = randomUUID();

/** Seeds a Part 5 school: tenant, a current year, and the built-in roles. */
async function seedSchool(c: Client, tenant: string, code: string, year: string) {
  await c.query(
    `INSERT INTO tenants (id, code, name, board, city, state, contact_email, status,
                          verified_at, terms_accepted_at, updated_at)
     VALUES ($1, $2, $3, 'CBSE', 'Dehradun', 'UK', $4, 'ACTIVE', now(), now(), now())`,
    [tenant, code, `School ${code}`, `admin@${code.toLowerCase()}.in`],
  );
  await c.query(
    `INSERT INTO academic_years (id, tenant_id, label, starts_on, ends_on, status, updated_at)
     VALUES ($1, $2, '2026–27', '2026-04-01', '2027-03-31', 'CURRENT', now())`,
    [year, tenant],
  );
  await c.query('SELECT seed_builtin_roles($1)', [tenant]);
}

describe('number series schema and migration', () => {
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

  /** Runs `fn` as the owner (no row-level security) inside a transaction, then rolls back. */
  async function asOwner<T>(fn: () => Promise<T>): Promise<T> {
    await owner.query('BEGIN');
    try {
      return await fn();
    } finally {
      await owner.query('ROLLBACK');
    }
  }

  const counter = (row: Record<string, unknown>) => ({
    tenant_id: A,
    key: 'ENQUIRY',
    period: YEAR_A,
    last_value: 0,
    ...row,
  });

  beforeAll(async () => {
    const pre = await preSettingsConfig();
    tmp = pre.dir;
    infra = await startTestInfra({ prismaConfig: pre.config });
    const seeder = new Client({ connectionString: infra.env.DATABASE_MIGRATION_URL });
    await seeder.connect();
    try {
      await seedSchool(seeder, A, 'SETA', YEAR_A);
      await seedSchool(seeder, B, 'SETB', YEAR_B);
      // School A's Admin already holds the permission: the grant must not fail on it.
      await seeder.query(
        `INSERT INTO role_permissions (role_id, tenant_id, permission)
         SELECT id, tenant_id, 'audit.view' FROM roles WHERE tenant_id = $1 AND key = 'ADMIN'`,
        [A],
      );
      // A custom role is not a built-in Admin, whatever its name.
      await seeder.query(
        `INSERT INTO roles (id, tenant_id, key, name, updated_at)
         VALUES ($1, $2, NULL, 'Office Admin', now())`,
        [randomUUID(), B],
      );
    } finally {
      await seeder.end();
    }
    await applyMigrations(infra.env.DATABASE_MIGRATION_URL as string);

    owner = new Client({ connectionString: infra.env.DATABASE_MIGRATION_URL });
    app = new Client({ connectionString: infra.env.DATABASE_URL });
    await Promise.all([owner.connect(), app.connect()]);

    // One counter per school, as the owner.
    await insert(owner, 'number_series_counters', counter({ last_value: 7 }));
    await insert(
      owner,
      'number_series_counters',
      counter({ tenant_id: B, period: YEAR_B, last_value: 3 }),
    );
  });

  afterAll(async () => {
    await Promise.allSettled([owner?.end(), app?.end()]);
    await infra?.stop();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  describe('migrating a Part 5 database', () => {
    it.each([A, B])('seeds the four default series for school %s', async (tenant) => {
      const res = await owner.query<{ key: string; pattern: string; reset: string }>(
        // Ordered by the enum, whose order is NUMBER_SERIES_KEYS'.
        `SELECT key::text AS key, pattern, reset::text AS reset FROM number_series s
          WHERE tenant_id = $1 ORDER BY s.key`,
        [tenant],
      );
      expect(res.rows).toEqual(NUMBER_SERIES_KEYS.map((key) => ({ key, ...DEFAULT_SERIES[key] })));
    });

    it('grants audit.view to every built-in Admin role, once', async () => {
      const res = await owner.query<{ tenant_id: string; n: string }>(
        `SELECT r.tenant_id, count(*) AS n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
          WHERE r.key = 'ADMIN' AND rp.permission = 'audit.view'
          GROUP BY r.tenant_id`,
      );
      expect(res.rows.map((r) => [r.tenant_id, Number(r.n)]).sort()).toEqual(
        [
          [A, 1],
          [B, 1],
        ].sort(),
      );
    });

    it('grants audit.view to no other role (Principal and custom roles do not get it)', async () => {
      const res = await owner.query<{ key: string | null }>(
        `SELECT r.key FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
          WHERE rp.permission = 'audit.view' AND r.key IS DISTINCT FROM 'ADMIN'`,
      );
      expect(res.rows).toEqual([]);
    });

    it('gives a school seeded after the migration an Admin with audit.view', async () => {
      const tenant = randomUUID();
      const perms = await asOwner(async () => {
        await owner.query(
          `INSERT INTO tenants (id, code, name, board, city, state, contact_email,
                                terms_accepted_at, updated_at)
           VALUES ($1, 'SETC', 'School SETC', 'CBSE', 'Dehradun', 'UK', 'a@setc.in', now(), now())`,
          [tenant],
        );
        await owner.query('SELECT seed_builtin_roles($1)', [tenant]);
        return (
          await owner.query<{ key: string }>(
            `SELECT r.key FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
              WHERE rp.tenant_id = $1 AND rp.permission = 'audit.view'`,
            [tenant],
          )
        ).rows;
      });
      expect(perms).toEqual([{ key: 'ADMIN' }]);
    });
  });

  describe('field rules', () => {
    it.each<[string, string, () => [string, Record<string, unknown>]]>([
      ['number_series', 'an empty pattern', () => ['number_series', { pattern: '' }]],
      [
        'number_series',
        'a 41-character pattern',
        () => ['number_series', { pattern: 'x'.repeat(41) }],
      ],
      ['number_series_counters', 'a negative last_value', () => ['counter', { last_value: -1 }]],
    ])('%s refuses %s', async (_table, _label, build) => {
      const [kind, change] = build();
      await expect(
        asApp(A, async () => {
          if (kind === 'number_series') {
            await app.query(`UPDATE number_series SET pattern = $1 WHERE key = 'ADMISSION'`, [
              change.pattern,
            ]);
          } else {
            await insert(app, 'number_series_counters', counter({ key: 'ADMISSION', ...change }));
          }
        }),
      ).rejects.toEqual(pgCode('23514'));
    });

    it('accepts the boundaries', async () => {
      await asApp(A, async () => {
        await app.query(`UPDATE number_series SET pattern = 'x' WHERE key = 'ADMISSION'`);
        await app.query(`UPDATE number_series SET pattern = $1 WHERE key = 'ENQUIRY'`, [
          'x'.repeat(40),
        ]);
        await insert(
          app,
          'number_series_counters',
          counter({ key: 'ADMISSION', period: 'ALL', last_value: 0 }),
        );
      });
    });

    it('refuses an unknown key or reset', async () => {
      await expect(
        asApp(A, () => insert(app, 'number_series_counters', counter({ key: 'INVOICE' }))),
      ).rejects.toEqual(pgCode('22P02'));
      await expect(
        asApp(A, () => app.query(`UPDATE number_series SET reset = 'WEEKLY'`)),
      ).rejects.toEqual(pgCode('22P02'));
    });

    it('refuses a second series for the same key', async () => {
      await expect(
        asApp(A, () =>
          insert(app, 'number_series', {
            tenant_id: A,
            key: 'ENQUIRY',
            pattern: '{SEQ:4}',
            reset: 'NEVER',
          }),
        ),
      ).rejects.toEqual(pgCode('23505'));
    });

    it('refuses a second counter for the same period', async () => {
      await expect(
        asApp(A, () => insert(app, 'number_series_counters', counter({}))),
      ).rejects.toEqual(pgCode('23505'));
    });

    it('refuses a period that is neither ALL nor an academic year id', async () => {
      await expect(
        asApp(A, () => insert(app, 'number_series_counters', counter({ period: '2026-27' }))),
      ).rejects.toEqual(pgCode('23514'));
    });

    it('deletes counters with their series', async () => {
      const left = await asOwner(async () => {
        await owner.query(`DELETE FROM number_series WHERE tenant_id = $1 AND key = 'ENQUIRY'`, [
          A,
        ]);
        return (await owner.query(`SELECT 1 FROM number_series_counters WHERE tenant_id = $1`, [A]))
          .rowCount;
      });
      expect(left).toBe(0);
    });

    it('refuses a counter without its series', async () => {
      await expect(
        asOwner(async () => {
          await owner.query(`DELETE FROM number_series WHERE tenant_id = $1 AND key = 'ENQUIRY'`, [
            A,
          ]);
          await owner.query(
            `INSERT INTO number_series_counters (tenant_id, key, period, last_value)
             VALUES ($1, 'ENQUIRY', 'ALL', 1)`,
            [A],
          );
        }),
      ).rejects.toEqual(pgCode('23503'));
    });

    it('still deletes a whole school, with its series and counters', async () => {
      const left = await asOwner(async () => {
        await owner.query(`DELETE FROM tenants WHERE id = $1`, [A]);
        const counts: number[] = [];
        for (const table of NEW_TABLES) {
          counts.push(
            (await owner.query(`SELECT 1 FROM ${table} WHERE tenant_id = $1`, [A])).rowCount ?? 0,
          );
        }
        return counts;
      });
      expect(left).toEqual([0, 0]);
    });
  });

  describe('row-level security', () => {
    it.each(NEW_TABLES)("hides another school's %s from the app role", async (table) => {
      const rows = await asApp(A, async () => {
        const res = await app.query<{ tenant_id: string }>(`SELECT tenant_id FROM ${table}`);
        return res.rows;
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenant_id === A)).toBe(true);
    });

    it.each(NEW_TABLES)('shows the app role no %s without a tenant context', async (table) => {
      const res = await asApp(null, () => app.query(`SELECT 1 FROM ${table}`));
      expect(res.rowCount).toBe(0);
    });

    it.each(NEW_TABLES)('enables and forces row-level security on %s', async (table) => {
      const res = await owner.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
        [table],
      );
      expect(res.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    });

    it("refuses writes carrying another school's tenant_id", async () => {
      await expect(
        asApp(A, () =>
          insert(app, 'number_series_counters', counter({ tenant_id: B, period: 'ALL' })),
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        asApp(A, () =>
          app.query(`UPDATE number_series SET tenant_id = $1 WHERE key = 'ENQUIRY'`, [B]),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("cannot update or delete another school's rows", async () => {
      const counts = await asApp(A, async () => {
        const out: number[] = [];
        for (const table of NEW_TABLES) {
          out.push(
            (await app.query(`UPDATE ${table} SET updated_at = now() WHERE tenant_id = $1`, [B]))
              .rowCount ?? 0,
            (await app.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [B])).rowCount ?? 0,
          );
        }
        return out;
      });
      expect(counts.every((n) => n === 0)).toBe(true);
    });

    it('lets the app role read, write and upsert its own counters', async () => {
      const value = await asApp(A, async () => {
        const res = await app.query<{ last_value: string }>(
          `INSERT INTO number_series_counters (tenant_id, key, period, last_value)
           VALUES ($1, 'ENQUIRY', $2, 1)
           ON CONFLICT (tenant_id, key, period)
           DO UPDATE SET last_value = number_series_counters.last_value + 1
           RETURNING last_value`,
          [A, YEAR_A],
        );
        return res.rows[0]!.last_value;
      });
      expect(value).toBe('8');
    });
  });

  describe('audit events', () => {
    const audit = (action: string, targetType: string) =>
      owner.query(
        `INSERT INTO audit_events (id, tenant_id, action, target_type, target_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), A, action, targetType, A],
      );

    it.each([
      ['number_series.updated', 'number_series'],
      ['audit.exported', 'audit'],
      // Earlier parts' actions and target types are kept.
      ['role.created', 'role'],
      ['member.invited', 'invitation'],
      ['member.roles_changed', 'membership'],
      ['school.profile_updated', 'school'],
      ['academic_year.made_current', 'academic_year'],
      ['campus.made_primary', 'campus'],
      ['sections.copied', 'academic_year'],
      ['class_subjects.updated', 'class_level'],
      ['room.deleted', 'room'],
      ['house.restored', 'house'],
    ])('accepts %s on a %s', async (action, targetType) => {
      await asOwner(() => audit(action, targetType));
    });

    it('rejects an unknown action or target type', async () => {
      await expect(asOwner(() => audit('number_series.deleted', 'number_series'))).rejects.toEqual(
        pgCode('23514'),
      );
      await expect(asOwner(() => audit('audit.exported', 'galaxy'))).rejects.toEqual(
        pgCode('23514'),
      );
    });
  });
});
