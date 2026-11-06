import { randomUUID } from 'node:crypto';

import { areaOfAction } from '@classloom/contracts';

import type { AuditAction, AuditTargetType } from '../../src/modules/iam/audit.service';
import { academicsHarness, type AcademicsSchool, problem } from '../academics/helpers';

const LIST = '/audit/events';
const CSV = '/audit/events.csv';

interface EventBody {
  id: string;
  action: string;
  area: string | null;
  createdAt: string;
  actor: { userId: string; name: string } | null;
  target: { type: string; id: string; label: string | null };
  changes: { field: string; before: unknown; after: unknown }[];
  ip: string | null;
  device: string | null;
}
interface PageBody {
  events: EventBody[];
  nextCursor: string | null;
}

interface Seed {
  action: AuditAction;
  targetType: AuditTargetType;
  targetId?: string;
  actorUserId?: string | null;
  createdAt: Date;
  before?: object | null;
  after?: object | null;
  ip?: string | null;
  userAgent?: string | null;
}

const BOM = String.fromCharCode(0xfeff);

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Splits RFC 4180 CSV text (CRLF rows, quoted cells) into rows of cells. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

describe('audit log (Part 6a spec section 5)', () => {
  const h = academicsHarness('AUD');

  beforeAll(() => h.start());
  afterAll(() => h.stop());

  const seed = (s: { tenantId: string }, events: Seed[]) =>
    h.owner.auditEvent.createMany({
      data: events.map((e) => ({
        tenantId: s.tenantId,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId ?? s.tenantId,
        actorUserId: e.actorUserId ?? null,
        createdAt: e.createdAt,
        before: e.before ?? undefined,
        after: e.after ?? undefined,
        ip: e.ip ?? null,
        userAgent: e.userAgent ?? null,
      })),
    });

  const list = async (s: AcademicsSchool, query = '', cookie = s.admin.cookie) => {
    const res = await h.get(`${LIST}${query}`, cookie);
    expect(res.status).toBe(200);
    return res.body as PageBody;
  };

  /** Every event the filter matches, following the cursor. */
  async function all(s: AcademicsSchool, query = ''): Promise<EventBody[]> {
    const out: EventBody[] = [];
    let cursor: string | null = null;
    do {
      const sep = query ? '&' : '?';
      const page = await list(
        s,
        cursor ? `${query}${sep}cursor=${encodeURIComponent(cursor)}` : query,
      );
      out.push(...page.events);
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  }

  const ACTIONS: [AuditAction, AuditTargetType][] = [
    ['role.created', 'role'],
    ['school.profile_updated', 'school'],
    ['campus.updated', 'campus'],
    ['house.created', 'house'],
    ['number_series.updated', 'number_series'],
  ];

  describe('paging', () => {
    let s: AcademicsSchool;
    beforeAll(async () => {
      s = await h.school();
      const base = Date.parse('2026-10-01T00:00:00.000Z');
      // 120 events, three to a timestamp, so the id breaks the ties.
      await seed(
        s,
        Array.from({ length: 120 }, (_, i) => {
          const [action, targetType] = ACTIONS[i % ACTIONS.length]!;
          return {
            action,
            targetType,
            targetId: randomUUID(),
            createdAt: new Date(base + Math.floor(i / 3) * 60_000),
          };
        }),
      );
    });

    it('gives 50 newest first with a cursor, and pages through all 120 exactly once', async () => {
      const first = await list(s);
      expect(first.events).toHaveLength(50);
      expect(first.nextCursor).toEqual(expect.any(String));
      const times = first.events.map((e) => Date.parse(e.createdAt));
      expect(times).toEqual([...times].sort((a, b) => b - a));

      const every = await all(s);
      expect(every).toHaveLength(120);
      expect(new Set(every.map((e) => e.id)).size).toBe(120);
      for (let i = 1; i < every.length; i += 1) {
        const [a, b] = [every[i - 1]!, every[i]!];
        const order = Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id > b.id ? 1 : -1);
        expect(order).toBeGreaterThan(0);
      }
    });

    it('honours limit up to 100, and refuses more', async () => {
      expect((await list(s, '?limit=100')).events).toHaveLength(100);
      expect((await h.get(`${LIST}?limit=101`, s.admin.cookie)).status).toBe(400);
    });

    it('refuses a cursor it did not make', async () => {
      const res = await h.get(`${LIST}?cursor=bm90LWEtY3Vyc29y`, s.admin.cookie);
      expect(res.status).toBe(400);
    });
  });

  describe('filters', () => {
    let s: AcademicsSchool;
    beforeAll(async () => {
      s = await h.school();
      await seed(s, [
        // 00:00 IST on 05/11 and one second before it.
        { action: 'role.created', targetType: 'role', createdAt: new Date('2026-11-04T18:30:00Z') },
        {
          action: 'role.created',
          targetType: 'role',
          createdAt: new Date('2026-11-04T18:29:59Z'),
        },
        // 23:30 IST on 05/11, and 00:00 IST on 06/11.
        {
          action: 'section.created',
          targetType: 'section',
          actorUserId: s.admin.userId,
          createdAt: new Date('2026-11-05T18:00:00Z'),
        },
        {
          action: 'subject.updated',
          targetType: 'subject',
          actorUserId: s.teacher.userId,
          createdAt: new Date('2026-11-05T18:30:00Z'),
        },
        {
          action: 'class_subjects.updated',
          targetType: 'class_level',
          createdAt: new Date('2026-11-03T10:00:00Z'),
        },
        {
          action: 'academic_year.created',
          targetType: 'academic_year',
          createdAt: new Date('2026-11-03T11:00:00Z'),
        },
      ]);
    });

    it('filters by area', async () => {
      const events = await all(s, '?area=academics');
      expect(events.map((e) => e.action).sort()).toEqual([
        'class_subjects.updated',
        'section.created',
        'subject.updated',
      ]);
      expect(events.every((e) => e.area === 'academics')).toBe(true);
      const calendar = await all(s, '?area=calendar');
      expect(calendar.map((e) => e.action)).toEqual(['academic_year.created']);
    });

    it('filters by person', async () => {
      const events = await all(s, `?actorUserId=${s.admin.userId}`);
      expect(events.map((e) => e.action)).toEqual(['section.created']);
      expect(events[0]!.actor).toEqual({
        userId: s.admin.userId,
        name: expect.any(String) as string,
      });
    });

    it('treats from and to as inclusive days in IST', async () => {
      const day = await all(s, '?from=2026-11-05&to=2026-11-05');
      expect(day.map((e) => e.createdAt)).toEqual([
        '2026-11-05T18:00:00.000Z',
        '2026-11-04T18:30:00.000Z',
      ]);
      const upTo = await all(s, '?to=2026-11-04');
      expect(upTo.map((e) => e.createdAt)).toEqual([
        '2026-11-04T18:29:59.000Z',
        '2026-11-03T11:00:00.000Z',
        '2026-11-03T10:00:00.000Z',
      ]);
    });

    it.each([
      ['an impossible date', '?from=2026-13-45'],
      ['a 30 February', '?to=2026-02-30'],
      ['a date that is not YYYY-MM-DD', '?from=05/11/2026'],
      ['an unknown area', '?area=fees'],
      ['a person id that is not a uuid', '?actorUserId=nobody'],
    ])('refuses %s with 400', async (_label, query) => {
      expect((await h.get(`${LIST}${query}`, s.admin.cookie)).status).toBe(400);
      expect((await h.get(`${CSV}${query}`, s.admin.cookie)).status).toBe(400);
    });
  });

  describe('each event', () => {
    it('labels the target at read time, and null when it is gone', async () => {
      const s = await h.school();
      const kept = await h.owner.role.create({ data: { tenantId: s.tenantId, name: 'Kept role' } });
      const gone = await h.owner.role.create({ data: { tenantId: s.tenantId, name: 'Gone role' } });
      await seed(s, [
        {
          action: 'role.created',
          targetType: 'role',
          targetId: kept.id,
          createdAt: new Date('2026-11-01T10:00:00Z'),
        },
        {
          action: 'role.deleted',
          targetType: 'role',
          targetId: gone.id,
          createdAt: new Date('2026-11-01T11:00:00Z'),
        },
        {
          action: 'member.deactivated',
          targetType: 'membership',
          targetId: s.teacher.membershipId,
          createdAt: new Date('2026-11-01T12:00:00Z'),
        },
        {
          action: 'school.profile_updated',
          targetType: 'school',
          createdAt: new Date('2026-11-01T13:00:00Z'),
        },
      ]);
      await h.owner.role.delete({ where: { id: gone.id } });
      const teacher = await h.owner.user.findUniqueOrThrow({ where: { id: s.teacher.userId } });
      const tenant = await h.owner.tenant.findUniqueOrThrow({ where: { id: s.tenantId } });

      const events = await all(s);
      const by = (action: string) => events.find((e) => e.action === action)!;
      expect(by('role.created').target).toEqual({ type: 'role', id: kept.id, label: 'Kept role' });
      expect(by('role.deleted').target).toEqual({ type: 'role', id: gone.id, label: null });
      expect(by('member.deactivated').target.label).toBe(teacher.name);
      expect(by('school.profile_updated').target.label).toBe(tenant.name);
    });

    it('names the actor from this school, and has no actor for a CLI change', async () => {
      const s = await h.school();
      await seed(s, [
        {
          action: 'role.created',
          targetType: 'role',
          actorUserId: s.admin.userId,
          createdAt: new Date('2026-11-01T10:00:00Z'),
          ip: '203.0.113.7',
          userAgent: CHROME_WINDOWS,
        },
        {
          action: 'member.two_factor_reset',
          targetType: 'membership',
          createdAt: new Date('2026-11-01T11:00:00Z'),
        },
      ]);
      const admin = await h.owner.user.findUniqueOrThrow({ where: { id: s.admin.userId } });
      const [cli, web] = await all(s);
      expect(cli!.actor).toBeNull();
      expect(cli!.ip).toBeNull();
      expect(cli!.device).toBeNull();
      expect(web!.actor).toEqual({ userId: s.admin.userId, name: admin.name });
      expect(web!.ip).toBe('203.0.113.7');
      expect(web!.device).toBe('Chrome on Windows');
      expect(web!.area).toBe('people');
    });

    it('builds changes from before and after, one entry per changed key', async () => {
      const s = await h.school();
      await seed(s, [
        {
          action: 'role.updated',
          targetType: 'role',
          createdAt: new Date('2026-11-01T10:00:00Z'),
          before: { name: 'Teachers', description: null, requiresTwoFactor: false },
          after: { name: 'Teacher', description: 'Class teachers', requiresTwoFactor: false },
        },
        {
          action: 'house.created',
          targetType: 'house',
          createdAt: new Date('2026-11-01T09:00:00Z'),
          after: { name: 'Tagore', colour: 'RED' },
        },
      ]);
      const [updated, created] = await all(s);
      expect(updated!.changes).toEqual([
        { field: 'name', before: 'Teachers', after: 'Teacher' },
        { field: 'description', before: null, after: 'Class teachers' },
      ]);
      expect(created!.changes).toEqual([
        { field: 'name', before: null, after: 'Tagore' },
        { field: 'colour', before: null, after: 'RED' },
      ]);
    });
  });

  describe('isolation and permissions', () => {
    it("never shows one school's events to another", async () => {
      const a = await h.school();
      const b = await h.school();
      await seed(a, [
        {
          action: 'role.created',
          targetType: 'role',
          actorUserId: a.admin.userId,
          createdAt: new Date('2026-11-01T10:00:00Z'),
        },
      ]);
      await seed(b, [
        {
          action: 'house.created',
          targetType: 'house',
          createdAt: new Date('2026-11-01T10:00:00Z'),
        },
      ]);
      const seen = await all(b);
      expect(seen.map((e) => e.action)).toEqual(['house.created']);
      expect(await all(b, `?actorUserId=${a.admin.userId}`)).toEqual([]);
      const csv = await h.get(CSV, b.admin.cookie);
      expect(csv.status).toBe(200);
      expect(parseCsv(csv.text.replace(BOM, ''))).toHaveLength(2);
    });

    it('refuses a member without audit.view with 403', async () => {
      const s = await h.school();
      for (const path of [LIST, CSV]) {
        const res = await h.get(path, s.teacher.cookie);
        expect(res.status).toBe(403);
        expect(problem(res).type).toBe('permission-denied');
      }
      const principal = await s.person('PRINCIPAL');
      expect((await h.get(LIST, principal.cookie)).status).toBe(403);
    });

    it('lets the Admin of a school granted audit.view by the migration read', async () => {
      const s = await h.school();
      const admin = await h.owner.role.findFirstOrThrow({
        where: { tenantId: s.tenantId, key: 'ADMIN' },
      });
      // A Part 5 school: its Admin had no audit.view before the settings migration.
      await h.owner.rolePermission.deleteMany({
        where: { roleId: admin.id, permission: 'audit.view' },
      });
      expect((await h.get(LIST, s.admin.cookie)).status).toBe(403);
      // The migration's grant (prisma/migrations/*_settings_6a, section 6).
      await h.owner.$executeRawUnsafe(`
        INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission")
        SELECT r."id", r."tenant_id", 'audit.view' FROM "roles" AS r WHERE r."key" = 'ADMIN'
        ON CONFLICT DO NOTHING`);
      expect((await h.get(LIST, s.admin.cookie)).status).toBe(200);
      expect((await h.get(CSV, s.admin.cookie)).status).toBe(200);
    });
  });

  describe('CSV export', () => {
    it('sends a header and one row per event, escaped and safe from formulas', async () => {
      const s = await h.school();
      const role = await h.owner.role.create({
        data: { tenantId: s.tenantId, name: '=SUM(A1:A9)' },
      });
      await seed(s, [
        {
          action: 'role.created',
          targetType: 'role',
          targetId: role.id,
          actorUserId: s.admin.userId,
          // 15:34 IST on 05/11.
          createdAt: new Date('2026-11-05T10:04:00Z'),
          after: { name: '=SUM(A1:A9)', description: 'Says "hi", twice\nand more' },
          ip: '203.0.113.7',
          userAgent: CHROME_WINDOWS,
        },
        {
          action: 'member.two_factor_reset',
          targetType: 'membership',
          createdAt: new Date('2026-11-04T10:00:00Z'),
        },
      ]);
      const admin = await h.owner.user.findUniqueOrThrow({ where: { id: s.admin.userId } });

      const res = await h.get(`${CSV}?from=2026-11-01&to=2026-11-06`, s.admin.cookie);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="audit-log-2026-11-01-2026-11-06.csv"',
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.text.startsWith(BOM)).toBe(true);
      const rows = parseCsv(res.text.replace(BOM, ''));
      expect(rows[0]).toEqual([
        'time (IST, DD/MM/YYYY HH:mm)',
        'person',
        'action',
        'target',
        'changes',
        'ip',
        'device',
      ]);
      expect(rows).toHaveLength(3);
      expect(rows[1]).toEqual([
        '05/11/2026 15:34',
        admin.name,
        'role.created',
        "'=SUM(A1:A9)",
        'name: — → =SUM(A1:A9); description: — → Says "hi", twice\nand more',
        '203.0.113.7',
        'Chrome on Windows',
      ]);
      expect(rows[2]!.slice(0, 2)).toEqual(['04/11/2026 15:30', 'System']);
    });

    it('writes one audit.exported row per export, with the filter', async () => {
      const s = await h.school();
      await seed(s, [
        {
          action: 'house.created',
          targetType: 'house',
          createdAt: new Date('2026-11-02T10:00:00Z'),
        },
      ]);
      const before = await h.audits(s.tenantId, 'audit');
      expect(before).toEqual([]);
      const res = await h.get(
        `${CSV}?from=2026-11-01&to=2026-11-06&area=academics`,
        s.admin.cookie,
      );
      expect(res.status).toBe(200);
      expect(parseCsv(res.text.replace(BOM, ''))).toHaveLength(2);
      const rows = await h.audits(s.tenantId, 'audit');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'audit.exported',
        targetType: 'audit',
        targetId: s.tenantId,
        actorUserId: s.admin.userId,
        before: null,
        after: { from: '2026-11-01', to: '2026-11-06', area: 'academics' },
      });
      expect(areaOfAction('audit.exported')).toBe('settings');
      // The export is itself listed.
      const page = await list(s, '?area=settings');
      expect(page.events.map((e) => e.action)).toEqual(['audit.exported']);
    });

    it('refuses more than 5,000 rows with 422 export-too-large, and records nothing', async () => {
      const s = await h.school();
      const base = Date.parse('2026-10-01T00:00:00Z');
      await seed(
        s,
        Array.from({ length: 5000 }, (_, i) => ({
          action: 'house.created' as const,
          targetType: 'house' as const,
          targetId: randomUUID(),
          createdAt: new Date(base + i * 1000),
        })),
      );
      const ok = await h.get(CSV, s.admin.cookie);
      expect(ok.status).toBe(200);
      expect(parseCsv(ok.text.replace(BOM, ''))).toHaveLength(5001);

      // 5,000 houses plus the audit.exported row just written: 5,001 rows match.
      const res = await h.get(CSV, s.admin.cookie);
      expect(res.status).toBe(422);
      expect(problem(res)).toMatchObject({ type: 'export-too-large', limit: 5000 });
      expect(await h.audits(s.tenantId, 'audit')).toHaveLength(1);
      // A narrower filter still exports.
      expect((await h.get(`${CSV}?area=settings`, s.admin.cookie)).status).toBe(200);
    });
  });
});
