import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from 'pg';

import { applyMigrations, startTestInfra, type TestInfra } from '../setup-containers';

const apiDir = path.resolve(__dirname, '../..');
const migrationsDir = path.join(apiDir, 'prisma/migrations');
const ACADEMICS_MIGRATION = '20261104100000_academics';

/**
 * A Prisma config whose migrations folder holds every migration before the academics one, so the
 * test can seed a database at the Part 4 schema and then apply the academics migration to it.
 */
async function preAcademicsConfig(): Promise<{ dir: string; config: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'classloom-pre-academics-'));
  const target = path.join(dir, 'migrations');
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name >= ACADEMICS_MIGRATION) continue;
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

/** Inserts one row (with a fresh id and updated_at unless given) and returns its id. */
async function insert(c: Client, table: string, row: Record<string, unknown>): Promise<string> {
  const full: Record<string, unknown> = { id: randomUUID(), updated_at: new Date(), ...row };
  const cols = Object.keys(full);
  await c.query(
    `INSERT INTO ${table} (${cols.join(', ')})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(full),
  );
  return full.id as string;
}

const NEW_TABLES = ['streams', 'subjects', 'class_subjects', 'houses', 'rooms', 'sections'];

// School A has two campuses, two years and two members; school B one of each.
const A = randomUUID();
const B = randomUUID();
const CAMPUS_A1 = randomUUID();
const CAMPUS_A2 = randomUUID();
const CAMPUS_B = randomUUID();
const YEAR_A = randomUUID();
const YEAR_A_PREV = randomUUID();
const YEAR_B = randomUUID();
const MEMBER_A = randomUUID();
const MEMBER_A2 = randomUUID();
const MEMBER_B = randomUUID();

/** Seeds a Part 4 school: tenant, campuses, years and memberships (with their users). */
async function seedSchool(
  c: Client,
  tenant: string,
  code: string,
  campuses: string[],
  years: { id: string; label: string; startsOn: string; endsOn: string; status: string }[],
  members: string[],
) {
  await c.query(
    `INSERT INTO tenants (id, code, name, board, city, state, contact_email, status,
                          verified_at, terms_accepted_at, updated_at)
     VALUES ($1, $2, $3, 'CBSE', 'Dehradun', 'UK', $4, 'ACTIVE', now(), now(), now())`,
    [tenant, code, `School ${code}`, `admin@${code.toLowerCase()}.in`],
  );
  await c.query(
    `INSERT INTO school_profiles (tenant_id, state, lowest_class, highest_class, updated_at)
     VALUES ($1, 'UK', 'NURSERY', 'XII', now())`,
    [tenant],
  );
  for (const [i, campus] of campuses.entries()) {
    await insert(c, 'campuses', {
      id: campus,
      tenant_id: tenant,
      name: `Campus ${i + 1}`,
      is_primary: i === 0,
      city: 'Dehradun',
      state: 'UK',
    });
  }
  for (const y of years) {
    await insert(c, 'academic_years', {
      id: y.id,
      tenant_id: tenant,
      label: y.label,
      starts_on: y.startsOn,
      ends_on: y.endsOn,
      status: y.status,
    });
  }
  for (const member of members) {
    const user = await insert(c, 'users', { email: `${member}@example.in`, name: 'Teacher' });
    await insert(c, 'memberships', { id: member, tenant_id: tenant, user_id: user });
  }
}

describe('academic structure schema and migration', () => {
  let infra: TestInfra;
  let tmp: string;
  let owner: Client;
  let app: Client;
  /** Row counts straight after the migration, before this test seeds anything new. */
  const countsAfterMigration: Record<string, number> = {};

  // Seeded after the migration, as the owner.
  const ids = {} as Record<
    | 'streamA'
    | 'streamB'
    | 'subjectA'
    | 'subjectB'
    | 'roomA1'
    | 'roomA2'
    | 'roomB'
    | 'houseA'
    | 'houseB'
    | 'sectionA'
    | 'sectionB'
    | 'classSubjectA'
    | 'classSubjectB',
    string
  >;

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

  const section = (row: Record<string, unknown>) => ({
    tenant_id: A,
    academic_year_id: YEAR_A,
    campus_id: CAMPUS_A1,
    class_level: 'V',
    name: 'B',
    capacity: 40,
    ...row,
  });
  const room = (row: Record<string, unknown>) => ({
    tenant_id: A,
    campus_id: CAMPUS_A1,
    name: 'Room 2',
    type: 'CLASSROOM',
    capacity: 40,
    ...row,
  });
  const classSubject = (row: Record<string, unknown>) => ({
    tenant_id: A,
    class_level: 'V',
    subject_id: ids.subjectA,
    kind: 'COMPULSORY',
    ...row,
  });

  beforeAll(async () => {
    const pre = await preAcademicsConfig();
    tmp = pre.dir;
    infra = await startTestInfra({ prismaConfig: pre.config });
    const seeder = new Client({ connectionString: infra.env.DATABASE_MIGRATION_URL });
    await seeder.connect();
    try {
      await seedSchool(
        seeder,
        A,
        'ACDA',
        [CAMPUS_A1, CAMPUS_A2],
        [
          {
            id: YEAR_A,
            label: '2026–27',
            startsOn: '2026-04-01',
            endsOn: '2027-03-31',
            status: 'CURRENT',
          },
          {
            id: YEAR_A_PREV,
            label: '2025–26',
            startsOn: '2025-04-01',
            endsOn: '2026-03-31',
            status: 'CLOSED',
          },
        ],
        [MEMBER_A, MEMBER_A2],
      );
      await seedSchool(
        seeder,
        B,
        'ACDB',
        [CAMPUS_B],
        [
          {
            id: YEAR_B,
            label: '2026–27',
            startsOn: '2026-04-01',
            endsOn: '2027-03-31',
            status: 'CURRENT',
          },
        ],
        [MEMBER_B],
      );
    } finally {
      await seeder.end();
    }
    await applyMigrations(infra.env.DATABASE_MIGRATION_URL as string);

    owner = new Client({ connectionString: infra.env.DATABASE_MIGRATION_URL });
    app = new Client({ connectionString: infra.env.DATABASE_URL });
    await Promise.all([owner.connect(), app.connect()]);
    for (const table of [
      ...NEW_TABLES,
      'campuses',
      'academic_years',
      'memberships',
      'school_profiles',
    ]) {
      countsAfterMigration[table] = Number(
        (await owner.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n,
      );
    }

    // One of everything per school, as the owner.
    for (const [tenant, campus, year, member, suffix] of [
      [A, CAMPUS_A1, YEAR_A, MEMBER_A, 'A'],
      [B, CAMPUS_B, YEAR_B, MEMBER_B, 'B'],
    ] as const) {
      const stream = await insert(owner, 'streams', { tenant_id: tenant, name: 'Science' });
      const subject = await insert(owner, 'subjects', {
        tenant_id: tenant,
        name: 'Physics',
        code: '042',
        type: 'SCHOLASTIC',
      });
      const roomId = await insert(owner, 'rooms', {
        tenant_id: tenant,
        campus_id: campus,
        name: 'Room 1',
        type: 'CLASSROOM',
        capacity: 40,
        floor: 'Ground',
      });
      const house = await insert(owner, 'houses', {
        tenant_id: tenant,
        name: 'Tagore',
        colour: 'RED',
      });
      const sectionId = await insert(owner, 'sections', {
        tenant_id: tenant,
        academic_year_id: year,
        campus_id: campus,
        class_level: 'XI',
        stream_id: stream,
        name: 'A',
        capacity: 40,
        room_id: roomId,
        class_teacher_membership_id: member,
      });
      const cs = await insert(owner, 'class_subjects', {
        tenant_id: tenant,
        class_level: 'XI',
        stream_id: stream,
        subject_id: subject,
        kind: 'COMPULSORY',
      });
      ids[`stream${suffix}`] = stream;
      ids[`subject${suffix}`] = subject;
      ids[`room${suffix === 'A' ? 'A1' : 'B'}`] = roomId;
      ids[`house${suffix}`] = house;
      ids[`section${suffix}`] = sectionId;
      ids[`classSubject${suffix}`] = cs;
    }
    ids.roomA2 = await insert(owner, 'rooms', {
      tenant_id: A,
      campus_id: CAMPUS_A2,
      name: 'Room 1',
      type: 'LAB',
      capacity: 30,
    });
  });

  afterAll(async () => {
    await Promise.allSettled([owner?.end(), app?.end()]);
    await infra?.stop();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  describe('migrating a Part 4 database', () => {
    it.each(NEW_TABLES)('creates %s empty (nothing is backfilled)', (table) => {
      expect(countsAfterMigration[table]).toBe(0);
    });

    it('keeps the existing campuses, years, memberships and profiles', () => {
      expect(countsAfterMigration).toMatchObject({
        campuses: 3,
        academic_years: 3,
        memberships: 3,
        school_profiles: 2,
      });
    });
  });

  describe('case-insensitive uniqueness (app role, school A)', () => {
    it.each<[string, string, Record<string, unknown>]>([
      ['streams', 'stream', { tenant_id: A, name: 'SCIENCE' }],
      ['subjects', 'subject', { tenant_id: A, name: 'physics', type: 'SCHOLASTIC' }],
      ['houses', 'house', { tenant_id: A, name: 'TAGORE', colour: 'BLUE' }],
      [
        'rooms',
        'room on the same campus',
        { tenant_id: A, campus_id: CAMPUS_A1, name: 'ROOM 1', type: 'LAB', capacity: 10 },
      ],
      [
        'sections',
        'section in the same year, campus and class',
        {
          tenant_id: A,
          academic_year_id: YEAR_A,
          campus_id: CAMPUS_A1,
          class_level: 'XI',
          stream_id: null,
          name: 'a',
          capacity: 30,
        },
      ],
    ])('refuses a duplicate in %s (%s)', async (table, _label, row) => {
      await expect(asApp(A, () => insert(app, table, row))).rejects.toEqual(pgCode('23505'));
    });

    it('allows the same room name on another campus', async () => {
      await asApp(A, () => insert(app, 'rooms', room({ campus_id: CAMPUS_A2, name: 'Room 2' })));
      // ...and "Room 1" exists on both A campuses already (seeded).
      expect(ids.roomA2).toBeDefined();
    });

    it('allows the same section name in another class, campus or year', async () => {
      await asApp(A, async () => {
        await insert(app, 'sections', section({ name: 'A' }));
        await insert(
          app,
          'sections',
          section({ name: 'A', class_level: 'XI', campus_id: CAMPUS_A2, stream_id: ids.streamA }),
        );
        await insert(
          app,
          'sections',
          section({
            name: 'A',
            class_level: 'XI',
            academic_year_id: YEAR_A_PREV,
            stream_id: ids.streamA,
          }),
        );
      });
    });

    it('refuses the same class teacher on two sections in one year', async () => {
      await expect(
        asApp(A, () => insert(app, 'sections', section({ class_teacher_membership_id: MEMBER_A }))),
      ).rejects.toEqual(pgCode('23505'));
    });

    it('allows the same class teacher in another year, and many sections without one', async () => {
      await asApp(A, async () => {
        await insert(
          app,
          'sections',
          section({ academic_year_id: YEAR_A_PREV, class_teacher_membership_id: MEMBER_A }),
        );
        await insert(app, 'sections', section({ name: 'C' }));
        await insert(app, 'sections', section({ name: 'D' }));
      });
    });

    it('refuses a duplicate class subject with no stream (NULLS NOT DISTINCT)', async () => {
      await expect(
        asApp(A, async () => {
          await insert(app, 'class_subjects', classSubject({}));
          await insert(app, 'class_subjects', classSubject({ kind: 'OPTIONAL' }));
        }),
      ).rejects.toEqual(pgCode('23505'));
    });

    it('refuses a duplicate class subject for the same stream', async () => {
      await expect(
        asApp(A, () =>
          insert(
            app,
            'class_subjects',
            classSubject({ class_level: 'XI', stream_id: ids.streamA, kind: 'OPTIONAL' }),
          ),
        ),
      ).rejects.toEqual(pgCode('23505'));
    });

    it('allows the same subject for every stream of a senior class next to one stream', async () => {
      await asApp(A, () =>
        insert(app, 'class_subjects', classSubject({ class_level: 'XI', stream_id: null })),
      );
    });

    it('allows subjects with the same code (codes are labels)', async () => {
      await asApp(A, () =>
        insert(app, 'subjects', {
          tenant_id: A,
          name: 'Physics (Old)',
          code: '042',
          type: 'SCHOLASTIC',
        }),
      );
    });
  });

  describe('field rules (CHECK constraints)', () => {
    it.each<[string, string, () => Record<string, unknown>]>([
      ['streams', 'a 1-character name', () => ({ tenant_id: A, name: 'S' })],
      ['streams', 'a 41-character name', () => ({ tenant_id: A, name: 'x'.repeat(41) })],
      ['subjects', 'a 1-character name', () => ({ tenant_id: A, name: 'P', type: 'SCHOLASTIC' })],
      [
        'subjects',
        'a 61-character name',
        () => ({ tenant_id: A, name: 'x'.repeat(61), type: 'SCHOLASTIC' }),
      ],
      [
        'subjects',
        'a code with a space',
        () => ({ tenant_id: A, name: 'Art', code: 'AB 1', type: 'SCHOLASTIC' }),
      ],
      [
        'subjects',
        'an 11-character code',
        () => ({ tenant_id: A, name: 'Art', code: 'A'.repeat(11), type: 'SCHOLASTIC' }),
      ],
      [
        'subjects',
        'an empty code',
        () => ({ tenant_id: A, name: 'Art', code: '', type: 'SCHOLASTIC' }),
      ],
      ['houses', 'a 1-character name', () => ({ tenant_id: A, name: 'H', colour: 'RED' })],
      [
        'houses',
        'a 41-character name',
        () => ({ tenant_id: A, name: 'x'.repeat(41), colour: 'RED' }),
      ],
      ['rooms', 'an empty name', () => room({ name: '' })],
      ['rooms', 'a 41-character name', () => room({ name: 'x'.repeat(41) })],
      ['rooms', 'capacity 0', () => room({ capacity: 0 })],
      ['rooms', 'capacity 501', () => room({ capacity: 501 })],
      ['rooms', 'a 21-character floor', () => room({ floor: 'x'.repeat(21) })],
      ['sections', 'an empty name', () => section({ name: '' })],
      ['sections', 'a 21-character name', () => section({ name: 'x'.repeat(21) })],
      ['sections', 'an untrimmed name', () => section({ name: ' B' })],
      ['sections', 'capacity 0', () => section({ capacity: 0 })],
      ['sections', 'capacity 201', () => section({ capacity: 201 })],
      ['sections', 'a stream on a junior class', () => section({ stream_id: ids.streamA })],
      [
        'class_subjects',
        'a stream on a junior class',
        () => classSubject({ stream_id: ids.streamA }),
      ],
    ])('%s refuses %s', async (table, _label, row) => {
      await expect(asApp(A, () => insert(app, table, row()))).rejects.toEqual(pgCode('23514'));
    });

    it('accepts the boundaries', async () => {
      await asApp(A, async () => {
        await insert(app, 'streams', { tenant_id: A, name: 'Ar' });
        await insert(app, 'streams', { tenant_id: A, name: 'x'.repeat(40) });
        await insert(app, 'subjects', {
          tenant_id: A,
          name: 'x'.repeat(60),
          code: 'Ab-1234567',
          type: 'CO_SCHOLASTIC',
        });
        await insert(app, 'houses', { tenant_id: A, name: 'x'.repeat(40), colour: 'GREY' });
        await insert(app, 'rooms', room({ name: 'R', capacity: 1, floor: 'x'.repeat(20) }));
        await insert(app, 'rooms', room({ name: 'x'.repeat(40), capacity: 500 }));
        await insert(app, 'sections', section({ name: 'x'.repeat(20), capacity: 200 }));
        await insert(app, 'sections', section({ name: 'Z', capacity: 1 }));
      });
    });
  });

  describe('foreign keys', () => {
    it('refuses a section whose room is on another campus', async () => {
      await expect(
        asApp(A, () => insert(app, 'sections', section({ room_id: ids.roomA2 }))),
      ).rejects.toEqual(pgCode('23503'));
    });

    it('accepts a section whose room is on its own campus', async () => {
      await asApp(A, () =>
        insert(app, 'sections', section({ campus_id: CAMPUS_A2, room_id: ids.roomA2 })),
      );
    });

    it.each<[string, () => [string, Record<string, unknown>]]>([
      ['subject', () => ['class_subjects', classSubject({ subject_id: ids.subjectB })]],
      [
        'stream (class subject)',
        () => ['class_subjects', classSubject({ class_level: 'XII', stream_id: ids.streamB })],
      ],
      [
        'stream (section)',
        () => ['sections', section({ class_level: 'XII', stream_id: ids.streamB })],
      ],
      ['room', () => ['sections', section({ campus_id: CAMPUS_B, room_id: ids.roomB })]],
      ['room (same id, own campus)', () => ['sections', section({ room_id: ids.roomB })]],
      ['year', () => ['sections', section({ academic_year_id: YEAR_B })]],
      ['campus (section)', () => ['sections', section({ campus_id: CAMPUS_B })]],
      ['campus (room)', () => ['rooms', room({ campus_id: CAMPUS_B })]],
      ['membership', () => ['sections', section({ class_teacher_membership_id: MEMBER_B })]],
    ])("refuses pointing at another school's %s", async (_label, build) => {
      const [table, row] = build();
      await expect(asApp(A, () => insert(app, table, row))).rejects.toEqual(pgCode('23503'));
    });

    it('clears only room_id when the room is deleted', async () => {
      const row = await asOwner(async () => {
        await owner.query(`DELETE FROM rooms WHERE id = $1`, [ids.roomA1]);
        return (
          await owner.query<Record<string, unknown>>(
            `SELECT room_id, campus_id, tenant_id FROM sections WHERE id = $1`,
            [ids.sectionA],
          )
        ).rows[0];
      });
      expect(row).toEqual({ room_id: null, campus_id: CAMPUS_A1, tenant_id: A });
    });

    it('clears only the class teacher when the membership is deleted', async () => {
      const row = await asOwner(async () => {
        await owner.query(`DELETE FROM memberships WHERE id = $1`, [MEMBER_A]);
        return (
          await owner.query<Record<string, unknown>>(
            `SELECT class_teacher_membership_id, tenant_id FROM sections WHERE id = $1`,
            [ids.sectionA],
          )
        ).rows[0];
      });
      expect(row).toEqual({ class_teacher_membership_id: null, tenant_id: A });
    });

    it('deletes the sections with their year', async () => {
      const n = await asOwner(async () => {
        await owner.query(`DELETE FROM academic_years WHERE id = $1`, [YEAR_A]);
        return (await owner.query(`SELECT 1 FROM sections WHERE tenant_id = $1`, [A])).rowCount;
      });
      expect(n).toBe(0);
    });

    it.each<[string, string, () => string]>([
      ['a stream used by a section or class subject', 'streams', () => ids.streamA],
      ['a subject used by a class subject', 'subjects', () => ids.subjectA],
      ['a campus with rooms or sections', 'campuses', () => CAMPUS_A1],
    ])('refuses to delete %s', async (_label, table, id) => {
      await expect(
        asOwner(() => owner.query(`DELETE FROM ${table} WHERE id = $1`, [id()])),
      ).rejects.toEqual(pgCode('23503'));
    });

    it('still deletes a whole school, with all its academic rows', async () => {
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
      expect(left).toEqual(NEW_TABLES.map(() => 0));
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
      const writes: [string, Record<string, unknown>][] = [
        ['streams', { tenant_id: B, name: 'Commerce' }],
        ['subjects', { tenant_id: B, name: 'Chemistry', type: 'SCHOLASTIC' }],
        ['houses', { tenant_id: B, name: 'Raman', colour: 'BLUE' }],
        ['rooms', { tenant_id: B, campus_id: CAMPUS_B, name: 'R9', type: 'HALL', capacity: 9 }],
        [
          'sections',
          {
            tenant_id: B,
            academic_year_id: YEAR_B,
            campus_id: CAMPUS_B,
            class_level: 'I',
            name: 'Z',
            capacity: 9,
          },
        ],
        [
          'class_subjects',
          { tenant_id: B, class_level: 'I', subject_id: ids.subjectB, kind: 'OPTIONAL' },
        ],
      ];
      for (const [table, row] of writes) {
        await expect(
          asApp(A, () => insert(app, table, row)),
          table,
        ).rejects.toThrow(/row-level security/);
      }
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
  });

  describe('audit events', () => {
    const audit = (action: string, targetType: string) =>
      owner.query(
        `INSERT INTO audit_events (id, tenant_id, action, target_type, target_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), A, action, targetType, CAMPUS_A1],
      );

    it.each([
      ['section.created', 'section'],
      ['section.updated', 'section'],
      ['section.deleted', 'section'],
      ['sections.copied', 'academic_year'],
      ['stream.created', 'stream'],
      ['stream.updated', 'stream'],
      ['stream.archived', 'stream'],
      ['stream.restored', 'stream'],
      ['stream.deleted', 'stream'],
      ['subject.created', 'subject'],
      ['subject.updated', 'subject'],
      ['subject.archived', 'subject'],
      ['subject.restored', 'subject'],
      ['subject.deleted', 'subject'],
      ['subjects.starter_added', 'school'],
      ['class_subjects.updated', 'class_level'],
      ['house.created', 'house'],
      ['house.updated', 'house'],
      ['house.archived', 'house'],
      ['house.restored', 'house'],
      ['house.deleted', 'house'],
      ['room.created', 'room'],
      ['room.updated', 'room'],
      ['room.archived', 'room'],
      ['room.restored', 'room'],
      ['room.deleted', 'room'],
      // Earlier parts' actions and target types are kept.
      ['role.created', 'role'],
      ['member.invited', 'invitation'],
      ['member.roles_changed', 'membership'],
      ['school.profile_updated', 'school'],
      ['academic_year.made_current', 'academic_year'],
      ['campus.made_primary', 'campus'],
    ])('accepts %s on a %s', async (action, targetType) => {
      await asOwner(() => audit(action, targetType));
    });

    it('rejects an unknown action or target type', async () => {
      await expect(asOwner(() => audit('section.exploded', 'section'))).rejects.toEqual(
        pgCode('23514'),
      );
      await expect(asOwner(() => audit('section.created', 'galaxy'))).rejects.toEqual(
        pgCode('23514'),
      );
    });
  });
});
