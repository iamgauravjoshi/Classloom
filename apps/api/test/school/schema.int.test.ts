import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from 'pg';

import { applyMigrations, startTestInfra, type TestInfra } from '../setup-containers';

const apiDir = path.resolve(__dirname, '../..');
const migrationsDir = path.join(apiDir, 'prisma/migrations');
const ONBOARDING_MIGRATION = '20261103100000_school_onboarding';

/**
 * A Prisma config whose migrations folder holds every migration before the onboarding one, so the
 * test can seed a database at the Part 3 schema and then apply the onboarding migration to it.
 */
async function preOnboardingConfig(): Promise<{ dir: string; config: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'classloom-pre-onboarding-'));
  const target = path.join(dir, 'migrations');
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name >= ONBOARDING_MIGRATION) continue;
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

/** The same server, another database. */
function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

const A = randomUUID();
const B = randomUUID();
const CAMPUS_A = randomUUID();
const CAMPUS_B = randomUUID();

/** Seeds a Part 3 school (tenant + its campuses) as the owner role. */
async function seedSchool(
  c: Client,
  id: string,
  code: string,
  city: string,
  state: string,
  campuses: { id: string; name: string; isPrimary: boolean }[],
) {
  await c.query(
    `INSERT INTO tenants (id, code, name, board, city, state, contact_email, status,
                          verified_at, terms_accepted_at, updated_at)
     VALUES ($1, $2, $3, 'CBSE', $4, $5, $6, 'ACTIVE', now(), now(), now())`,
    [id, code, `School ${code}`, city, state, `admin@${code.toLowerCase()}.in`],
  );
  for (const campus of campuses) {
    // The campus keeps its own city, distinct from the school's, to show the backfill reads tenants.
    await c.query(
      `INSERT INTO campuses (id, tenant_id, name, is_primary, city, state, updated_at)
       VALUES ($1, $2, $3, $4, 'Campus Town', 'DL', now())`,
      [campus.id, id, campus.name, campus.isPrimary],
    );
  }
}

/** Matches a pg error by its SQLSTATE (23505 unique, 23514 check, 23P01 exclusion, ...). */
const pgCode = (code: string): unknown => expect.objectContaining({ code }) as unknown;

describe('school onboarding schema and migration', () => {
  let infra: TestInfra;
  let tmp: string;
  let preConfig: string;
  let owner: Client;
  let app: Client;
  /** Counted straight after the migration, before this test seeds any year. */
  let yearsAfterMigration: number;

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

  async function insertYear(
    c: Client,
    tenant: string,
    label: string,
    startsOn: string,
    endsOn: string,
    status: 'PLANNED' | 'CURRENT' | 'CLOSED',
    id = randomUUID(),
  ): Promise<string> {
    await c.query(
      `INSERT INTO academic_years (id, tenant_id, label, starts_on, ends_on, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [id, tenant, label, startsOn, endsOn, status],
    );
    return id;
  }

  async function insertFile(c: Client, tenant: string, id = randomUUID()): Promise<string> {
    await c.query(
      `INSERT INTO files (id, tenant_id, purpose, storage_key, content_type, byte_size, width,
                          height, sha256)
       VALUES ($1, $2, 'SCHOOL_LOGO', $3, 'image/png', 1024, 256, 256, $4)`,
      [id, tenant, `tenants/${tenant}/SCHOOL_LOGO/${id}.png`, Buffer.alloc(32, 7)],
    );
    return id;
  }

  beforeAll(async () => {
    const pre = await preOnboardingConfig();
    tmp = pre.dir;
    preConfig = pre.config;
    infra = await startTestInfra({ prismaConfig: pre.config });
    const seeder = new Client({ connectionString: infra.env.DATABASE_MIGRATION_URL });
    await seeder.connect();
    try {
      await seedSchool(seeder, A, 'ONBA', 'Dehradun', 'UK', [
        { id: CAMPUS_A, name: 'Main', isPrimary: true },
      ]);
      await seedSchool(seeder, B, 'ONBB', 'Lucknow', 'UP', [
        { id: CAMPUS_B, name: 'Main', isPrimary: true },
      ]);
    } finally {
      await seeder.end();
    }
    await applyMigrations(infra.env.DATABASE_MIGRATION_URL as string);

    owner = new Client({ connectionString: infra.env.DATABASE_MIGRATION_URL });
    app = new Client({ connectionString: infra.env.DATABASE_URL });
    await Promise.all([owner.connect(), app.connect()]);
    yearsAfterMigration = Number(
      (await owner.query<{ n: string }>('SELECT count(*) AS n FROM academic_years')).rows[0]!.n,
    );

    // One file, one year and its terms per school, seeded as the owner.
    for (const tenant of [A, B]) {
      const file = await insertFile(owner, tenant);
      await owner.query(`UPDATE school_profiles SET logo_file_id = $1 WHERE tenant_id = $2`, [
        file,
        tenant,
      ]);
      const year = await insertYear(
        owner,
        tenant,
        '2026–27',
        '2026-04-01',
        '2027-03-31',
        'CURRENT',
      );
      for (const [seq, startsOn, endsOn] of [
        [1, '2026-04-01', '2026-09-30'],
        [2, '2026-10-01', '2027-03-31'],
      ] as const) {
        await owner.query(
          `INSERT INTO academic_terms (id, tenant_id, academic_year_id, seq, name, starts_on,
                                       ends_on, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
          [randomUUID(), tenant, year, seq, `Term ${seq}`, startsOn, endsOn],
        );
      }
    }
  });

  afterAll(async () => {
    await Promise.allSettled([owner?.end(), app?.end()]);
    await infra?.stop();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  describe('migrating a school that existed before onboarding', () => {
    it('creates exactly one profile per school, with city and state copied from tenants', async () => {
      const res = await owner.query<{ tenant_id: string; city: string; state: string }>(
        `SELECT tenant_id, city, state FROM school_profiles ORDER BY city`,
      );
      expect(res.rows).toEqual([
        { tenant_id: A, city: 'Dehradun', state: 'UK' },
        { tenant_id: B, city: 'Lucknow', state: 'UP' },
      ]);
    });

    it('leaves every other profile field empty', async () => {
      const res = await owner.query<Record<string, unknown>>(
        `SELECT legal_name, short_name, established_year, udise_code, affiliation_number,
                school_type, residential, medium, lowest_class, highest_class, phone, email,
                website, address_line1, address_line2, district, pin_code,
                onboarding_started_at, onboarding_dismissed_at
           FROM school_profiles`,
      );
      for (const row of res.rows) {
        expect(Object.values(row).every((v) => v === null)).toBe(true);
      }
    });

    it('creates no academic year', () => {
      expect(yearsAfterMigration).toBe(0);
    });

    it('keeps existing campuses, with the new columns null', async () => {
      const res = await owner.query(
        `SELECT id, tenant_id, name, is_primary, city, state, status, address_line1,
                address_line2, district, pin_code, phone, email
           FROM campuses ORDER BY tenant_id = $1 DESC`,
        [A],
      );
      expect(res.rows).toEqual([
        {
          id: CAMPUS_A,
          tenant_id: A,
          name: 'Main',
          is_primary: true,
          city: 'Campus Town',
          state: 'DL',
          status: 'ACTIVE',
          address_line1: null,
          address_line2: null,
          district: null,
          pin_code: null,
          phone: null,
          email: null,
        },
        expect.objectContaining({ id: CAMPUS_B, tenant_id: B, name: 'Main', is_primary: true }),
      ]);
    });

    it('installs btree_gist', async () => {
      const res = await owner.query(`SELECT 1 FROM pg_extension WHERE extname = 'btree_gist'`);
      expect(res.rowCount).toBe(1);
    });
  });

  describe('migration guard', () => {
    const cases: [string, { id: string; name: string; isPrimary: boolean }[]][] = [
      [
        'two primary campuses',
        [
          { id: randomUUID(), name: 'Main', isPrimary: true },
          { id: randomUUID(), name: 'Annexe', isPrimary: true },
        ],
      ],
      ['no primary campus', [{ id: randomUUID(), name: 'Main', isPrimary: false }]],
    ];

    it.each(cases)('aborts when a school has %s', async (_label, campuses) => {
      const database = `guard_${randomUUID().replaceAll('-', '')}`;
      await owner.query(`CREATE DATABASE ${database}`);
      const url = withDatabase(infra.env.DATABASE_MIGRATION_URL as string, database);
      try {
        await applyMigrations(url, preConfig);
        const c = new Client({ connectionString: url });
        await c.connect();
        try {
          // The Part 1 index forbids two primaries; drop it to simulate a corrupted school.
          await c.query('DROP INDEX campuses_one_primary');
          await seedSchool(c, randomUUID(), 'GRDA', 'Dehradun', 'UK', campuses);
        } finally {
          await c.end();
        }
        await expect(applyMigrations(url)).rejects.toThrow(
          /1 school\(s\) without exactly one primary campus/,
        );
      } finally {
        await owner.query(`DROP DATABASE ${database} WITH (FORCE)`);
      }
    });
  });

  describe('academic year constraints (app role, school A)', () => {
    it('refuses an overlapping year with an exclusion violation', async () => {
      await expect(
        asApp(A, () => insertYear(app, A, 'Overlap', '2027-01-01', '2027-12-31', 'CLOSED')),
      ).rejects.toEqual(pgCode('23P01'));
    });

    it('refuses a second CURRENT year', async () => {
      await expect(
        asApp(A, () => insertYear(app, A, '2028–29', '2028-04-01', '2029-03-31', 'CURRENT')),
      ).rejects.toEqual(pgCode('23505'));
    });

    it('refuses a second PLANNED year', async () => {
      await expect(
        asApp(A, async () => {
          await insertYear(app, A, '2027–28', '2027-04-01', '2028-03-31', 'PLANNED');
          await insertYear(app, A, '2028–29', '2028-04-01', '2029-03-31', 'PLANNED');
        }),
      ).rejects.toEqual(pgCode('23505'));
    });

    it('allows one PLANNED year next to the CURRENT one', async () => {
      await asApp(A, () => insertYear(app, A, '2027–28', '2027-04-01', '2028-03-31', 'PLANNED'));
    });

    it('refuses a label differing only in case', async () => {
      await expect(
        asApp(A, async () => {
          await insertYear(app, A, 'Year A', '2020-04-01', '2021-03-31', 'CLOSED');
          await insertYear(app, A, 'YEAR a', '2021-04-01', '2022-03-31', 'CLOSED');
        }),
      ).rejects.toEqual(pgCode('23505'));
    });

    it.each([
      ['too short (179 days)', '2020-04-01', '2020-09-27'],
      ['too long (401 days)', '2020-04-01', '2021-05-07'],
      ['ending before it starts', '2020-04-01', '2020-03-01'],
    ])('refuses a year %s', async (_label, startsOn, endsOn) => {
      await expect(
        asApp(A, () => insertYear(app, A, 'Odd', startsOn, endsOn, 'CLOSED')),
      ).rejects.toEqual(pgCode('23514'));
    });

    it('refuses a label longer than 20 characters', async () => {
      await expect(
        asApp(A, () => insertYear(app, A, 'x'.repeat(21), '2020-04-01', '2021-03-31', 'CLOSED')),
      ).rejects.toEqual(pgCode('23514'));
    });

    it('refuses a term with seq 4', async () => {
      const year = await owner.query<{ id: string }>(
        `SELECT id FROM academic_years WHERE tenant_id = $1`,
        [A],
      );
      await expect(
        asApp(A, () =>
          app.query(
            `INSERT INTO academic_terms (id, tenant_id, academic_year_id, seq, name, starts_on,
                                         ends_on, updated_at)
             VALUES ($1, $2, $3, 4, 'Term 4', '2027-01-01', '2027-03-31', now())`,
            [randomUUID(), A, year.rows[0]!.id],
          ),
        ),
      ).rejects.toEqual(pgCode('23514'));
    });

    it("refuses a term pointing at another school's year", async () => {
      const yearB = await owner.query<{ id: string }>(
        `SELECT id FROM academic_years WHERE tenant_id = $1`,
        [B],
      );
      await expect(
        asApp(A, () =>
          app.query(
            `INSERT INTO academic_terms (id, tenant_id, academic_year_id, seq, name, starts_on,
                                         ends_on, updated_at)
             VALUES ($1, $2, $3, 3, 'Term 3', '2027-01-01', '2027-03-31', now())`,
            [randomUUID(), A, yearB.rows[0]!.id],
          ),
        ),
      ).rejects.toEqual(pgCode('23503'));
    });

    it('deletes the terms with their year', async () => {
      await owner.query('BEGIN');
      try {
        await owner.query(`DELETE FROM academic_years WHERE tenant_id = $1`, [A]);
        const res = await owner.query(`SELECT 1 FROM academic_terms WHERE tenant_id = $1`, [A]);
        expect(res.rowCount).toBe(0);
      } finally {
        await owner.query('ROLLBACK');
      }
    });
  });

  describe('campus constraints (app role, school A)', () => {
    const insertCampus = (name: string, isPrimary: boolean) =>
      app.query(
        `INSERT INTO campuses (id, tenant_id, name, is_primary, city, state, updated_at)
         VALUES ($1, $2, $3, $4, 'Dehradun', 'UK', now())`,
        [randomUUID(), A, name, isPrimary],
      );

    it('refuses a second primary campus', async () => {
      await expect(asApp(A, () => insertCampus('North', true))).rejects.toEqual(pgCode('23505'));
    });

    it('refuses a campus name differing only in case', async () => {
      await expect(asApp(A, () => insertCampus('MAIN', false))).rejects.toEqual(pgCode('23505'));
    });

    it('allows a second, non-primary campus with its contact details', async () => {
      await asApp(A, () =>
        app.query(
          `INSERT INTO campuses (id, tenant_id, name, is_primary, city, state, address_line1,
                                 district, pin_code, phone, email, updated_at)
           VALUES ($1, $2, 'North', false, 'Dehradun', 'UK', '1 Rajpur Road', 'Dehradun',
                   '248001', '+911352345678', 'north@school.in', now())`,
          [randomUUID(), A],
        ),
      );
    });

    it.each([
      ['pin_code', '048001'],
      ['phone', '9876543210'],
      ['address_line1', 'x'.repeat(121)],
      ['district', 'x'.repeat(61)],
    ])('refuses an invalid campus %s', async (column, value) => {
      await expect(
        asApp(A, () =>
          app.query(`UPDATE campuses SET ${column} = $1 WHERE id = $2`, [value, CAMPUS_A]),
        ),
      ).rejects.toEqual(pgCode('23514'));
    });
  });

  describe('school profile constraints', () => {
    it.each([
      ['udise_code', '39123456789'],
      ['udise_code', '0912345678'],
      ['pin_code', '012345'],
      ['affiliation_number', 'AB 12'],
      ['short_name', 'x'.repeat(13)],
      ['legal_name', 'x'.repeat(151)],
      ['medium', 'x'.repeat(41)],
      ['website', 'http://school.in'],
      ['website', `https://${'x'.repeat(193)}.in`],
      ['phone', '+9198765'],
      ['city', 'x'.repeat(61)],
    ])('refuses %s = %s', async (column, value) => {
      await expect(
        asApp(A, () =>
          app.query(`UPDATE school_profiles SET ${column} = $1 WHERE tenant_id = $2`, [value, A]),
        ),
      ).rejects.toEqual(pgCode('23514'));
    });

    it('refuses an established year before 1800', async () => {
      await expect(
        asApp(A, () =>
          app.query(`UPDATE school_profiles SET established_year = 1799 WHERE tenant_id = $1`, [A]),
        ),
      ).rejects.toEqual(pgCode('23514'));
    });

    it('refuses a lowest class above the highest class', async () => {
      await expect(
        asApp(A, () =>
          app.query(
            `UPDATE school_profiles SET lowest_class = 'XII', highest_class = 'NURSERY'
              WHERE tenant_id = $1`,
            [A],
          ),
        ),
      ).rejects.toEqual(pgCode('23514'));
    });

    it('accepts a fully filled-in profile', async () => {
      await asApp(A, () =>
        app.query(
          `UPDATE school_profiles
              SET legal_name = 'Doon Education Society', short_name = 'DPS-D',
                  established_year = 1985, udise_code = '05060100101', affiliation_number = '3530/12-A',
                  school_type = 'CO_ED', residential = 'DAY_AND_BOARDING', medium = 'English',
                  lowest_class = 'NURSERY', highest_class = 'XII', phone = '+919876543210',
                  email = 'office@school.in', website = 'https://school.in',
                  address_line1 = '1 Rajpur Road', address_line2 = 'Near Clock Tower',
                  district = 'Dehradun', pin_code = '248001'
            WHERE tenant_id = $1`,
          [A],
        ),
      );
    });

    it("refuses to point the logo at another school's file", async () => {
      const fileB = await owner.query<{ id: string }>(`SELECT id FROM files WHERE tenant_id = $1`, [
        B,
      ]);
      await expect(
        asApp(A, () =>
          app.query(`UPDATE school_profiles SET logo_file_id = $1 WHERE tenant_id = $2`, [
            fileB.rows[0]!.id,
            A,
          ]),
        ),
      ).rejects.toEqual(pgCode('23503'));
    });

    it('clears the logo when its file is deleted', async () => {
      await owner.query('BEGIN');
      try {
        await owner.query(`DELETE FROM files WHERE tenant_id = $1`, [A]);
        const res = await owner.query<{ logo_file_id: string | null; tenant_id: string }>(
          `SELECT tenant_id, logo_file_id FROM school_profiles WHERE tenant_id = $1`,
          [A],
        );
        expect(res.rows).toEqual([{ tenant_id: A, logo_file_id: null }]);
      } finally {
        await owner.query('ROLLBACK');
      }
    });

    it('refuses a file whose sha256 is not 32 bytes', async () => {
      await expect(
        asApp(A, () =>
          app.query(
            `INSERT INTO files (id, tenant_id, purpose, storage_key, content_type, byte_size,
                                width, height, sha256)
             VALUES ($1, $2, 'SCHOOL_LOGO', 'k', 'image/png', 1, 1, 1, '\\x00')`,
            [randomUUID(), A],
          ),
        ),
      ).rejects.toEqual(pgCode('23514'));
    });
  });

  describe('row-level security', () => {
    const tables = ['school_profiles', 'files', 'academic_years', 'academic_terms', 'campuses'];

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

    it("refuses writes carrying another school's tenant_id", async () => {
      const yearB = (
        await owner.query<{ id: string }>(`SELECT id FROM academic_years WHERE tenant_id = $1`, [B])
      ).rows[0]!.id;
      const writes: [string, (c: Client) => Promise<unknown>][] = [
        [
          'school_profiles',
          (c) =>
            c.query(
              `INSERT INTO school_profiles (tenant_id, state, updated_at)
                     VALUES ($1, 'UP', now())`,
              [B],
            ),
        ],
        ['files', (c) => insertFile(c, B)],
        ['academic_years', (c) => insertYear(c, B, 'Sneaky', '2030-04-01', '2031-03-31', 'CLOSED')],
        [
          'academic_terms',
          (c) =>
            c.query(
              `INSERT INTO academic_terms (id, tenant_id, academic_year_id, seq, name, starts_on,
                                           ends_on, updated_at)
               VALUES ($1, $2, $3, 3, 'Term 3', '2027-01-01', '2027-03-31', now())`,
              [randomUUID(), B, yearB],
            ),
        ],
        [
          'campuses',
          (c) =>
            c.query(
              `INSERT INTO campuses (id, tenant_id, name, is_primary, city, state, updated_at)
               VALUES ($1, $2, 'Sneaky', false, 'Lucknow', 'UP', now())`,
              [randomUUID(), B],
            ),
        ],
      ];
      for (const [table, write] of writes) {
        await expect(
          asApp(A, () => write(app)),
          table,
        ).rejects.toThrow(/row-level security/);
      }
    });

    it("cannot update another school's profile", async () => {
      const res = await asApp(A, () =>
        app.query(`UPDATE school_profiles SET medium = 'Hindi' WHERE tenant_id = $1`, [B]),
      );
      expect(res.rowCount).toBe(0);
    });
  });

  describe('audit events', () => {
    const audit = (action: string, targetType: string) =>
      owner.query(
        `INSERT INTO audit_events (id, tenant_id, action, target_type, target_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), A, action, targetType, CAMPUS_A],
      );

    it.each([
      ['school.profile_updated', 'school'],
      ['school.logo_changed', 'school'],
      ['school.logo_removed', 'school'],
      ['academic_year.created', 'academic_year'],
      ['academic_year.updated', 'academic_year'],
      ['academic_year.made_current', 'academic_year'],
      ['academic_year.deleted', 'academic_year'],
      ['campus.created', 'campus'],
      ['campus.updated', 'campus'],
      ['campus.deactivated', 'campus'],
      ['campus.reactivated', 'campus'],
      ['campus.made_primary', 'campus'],
      ['role.created', 'role'],
    ])('accepts %s on a %s', async (action, targetType) => {
      await owner.query('BEGIN');
      try {
        await audit(action, targetType);
      } finally {
        await owner.query('ROLLBACK');
      }
    });

    it('rejects an unknown action or target type', async () => {
      await expect(audit('campus.exploded', 'campus')).rejects.toEqual(pgCode('23514'));
      await expect(audit('campus.created', 'galaxy')).rejects.toEqual(pgCode('23514'));
    });
  });
});
