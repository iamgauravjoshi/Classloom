import { DEFAULT_SERIES, NUMBER_SERIES_KEYS, type NumberSeriesKey } from '@classloom/contracts';

import { PrismaService } from '../../src/core/prisma/prisma.service';
import { withTenant } from '../../src/core/tenancy/with-tenant';
import { SessionService } from '../../src/modules/auth/session.service';
import {
  NumberSeriesExhausted,
  NumberSeriesService,
} from '../../src/modules/settings/number-series.service';
import { academicsHarness, type AcademicsSchool } from '../academics/helpers';

const BASE = '/settings/number-series';

interface SeriesBody {
  key: NumberSeriesKey;
  name: string;
  pattern: string;
  reset: 'ACADEMIC_YEAR' | 'NEVER';
  nextNumber: number;
  preview: string | null;
}

interface ProblemBody {
  type?: string;
  problem?: string;
  minimum?: number;
}

describe('number series (Part 6a spec section 3)', () => {
  const h = academicsHarness('NS');
  let service: NumberSeriesService;
  let prisma: PrismaService;
  let sessions: SessionService;
  let counter = 0;

  beforeAll(async () => {
    await h.start();
    service = h.app.get(NumberSeriesService);
    prisma = h.app.get(PrismaService);
    sessions = h.app.get(SessionService);
  });
  afterAll(() => h.stop());

  type School = AcademicsSchool & { yearId: string | null };

  /** A school with the four default series and, unless told otherwise, a CURRENT 2026-27 year. */
  async function school(withYear = true): Promise<School> {
    const s = await h.school();
    await h.owner.numberSeries.createMany({
      data: NUMBER_SERIES_KEYS.map((key) => ({
        tenantId: s.tenantId,
        key,
        ...DEFAULT_SERIES[key],
      })),
    });
    const yearId = withYear ? await h.year(s.tenantId, 2026, 'CURRENT') : null;
    return { ...s, yearId };
  }

  const year = (id: string | null, startYear = 2026) => ({
    id: id as string,
    startsOn: `${startYear}-04-01`,
  });

  const issue = (s: { tenantId: string }, key: NumberSeriesKey, y = year(null)) =>
    withTenant(prisma, s.tenantId, (tx) => service.next(tx, key, y));

  const issueMany = async (s: School, key: NumberSeriesKey, n: number) => {
    const out: string[] = [];
    for (let i = 0; i < n; i += 1) out.push((await issue(s, key, year(s.yearId))).value);
    return out;
  };

  const list = async (s: School, cookie = s.admin.cookie) => {
    const res = await h.get(BASE, cookie);
    expect(res.status).toBe(200);
    return (res.body as { series: SeriesBody[] }).series;
  };
  const one = async (s: School, key: NumberSeriesKey) =>
    (await list(s)).find((x) => x.key === key) as SeriesBody;

  const patch = (s: School, key: string, body: object, cookie = s.admin.cookie) =>
    h.patch(`${BASE}/${key}`, cookie).send(body);

  const counters = (tenantId: string) =>
    h.owner.numberSeriesCounter.findMany({ where: { tenantId }, orderBy: { period: 'asc' } });

  /** A member holding only a custom role with `permissions`. */
  async function custom(s: School, permissions: string[]): Promise<string> {
    counter += 1;
    const role = await h.owner.role.create({
      data: { tenantId: s.tenantId, name: `Custom ${counter}` },
    });
    if (permissions.length > 0) {
      await h.owner.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: role.id,
          tenantId: s.tenantId,
          permission,
        })),
      });
    }
    const user = await h.owner.user.create({
      data: { email: `c${counter}@ns-custom.test`, name: `Custom ${counter}` },
    });
    const m = await h.owner.membership.create({ data: { tenantId: s.tenantId, userId: user.id } });
    await h.owner.membershipRole.create({
      data: { tenantId: s.tenantId, membershipId: m.id, roleId: role.id },
    });
    const { token } = await sessions.create({
      tenantId: s.tenantId,
      userId: user.id,
      membershipId: m.id,
      remember: false,
    });
    return `cl_session=${token}`;
  }

  describe('reading', () => {
    it('lists the four defaults with the next number and a preview for the current year', async () => {
      const s = await school();
      const series = await list(s);
      expect(series).toEqual([
        {
          key: 'ENQUIRY',
          name: 'Enquiry',
          pattern: 'ENQ/{AY}/{SEQ:4}',
          reset: 'ACADEMIC_YEAR',
          nextNumber: 1,
          preview: 'ENQ/2026-27/0001',
        },
        {
          key: 'APPLICATION',
          name: 'Application',
          pattern: 'APP/{AY}/{SEQ:4}',
          reset: 'ACADEMIC_YEAR',
          nextNumber: 1,
          preview: 'APP/2026-27/0001',
        },
        {
          key: 'ADMISSION',
          name: 'Admission',
          pattern: '{SEQ:5}',
          reset: 'NEVER',
          nextNumber: 1,
          preview: '00001',
        },
        {
          key: 'FEE_RECEIPT',
          name: 'Fee receipt',
          pattern: 'REC/{AY}/{SEQ:5}',
          reset: 'ACADEMIC_YEAR',
          nextNumber: 1,
          preview: 'REC/2026-27/00001',
        },
      ]);
    });

    it('gives no preview without a current year', async () => {
      const s = await school(false);
      const series = await list(s);
      expect(series.map((x) => x.preview)).toEqual([null, null, null, null]);
      expect(series.map((x) => x.nextNumber)).toEqual([1, 1, 1, 1]);
    });

    it('shows the next number after numbers are issued', async () => {
      const s = await school();
      await issueMany(s, 'ENQUIRY', 3);
      expect(await one(s, 'ENQUIRY')).toMatchObject({
        nextNumber: 4,
        preview: 'ENQ/2026-27/0004',
      });
    });
  });

  describe('issuing numbers', () => {
    it('formats with the series pattern and the year', async () => {
      const s = await school();
      expect(await issue(s, 'ENQUIRY', year(s.yearId))).toEqual({
        value: 'ENQ/2026-27/0001',
        sequence: 1,
      });
      expect(await issue(s, 'ADMISSION', year(s.yearId))).toEqual({ value: '00001', sequence: 1 });
      expect(await issue(s, 'ENQUIRY', year(s.yearId))).toEqual({
        value: 'ENQ/2026-27/0002',
        sequence: 2,
      });
    });

    it('gives 20 concurrent callers sequences 1-20 exactly once each', async () => {
      const s = await school();
      const results = await Promise.all(
        Array.from({ length: 20 }, () => issue(s, 'ENQUIRY', year(s.yearId))),
      );
      expect(results.map((r) => r.sequence).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
      expect(new Set(results.map((r) => r.value)).size).toBe(20);
    });

    it('rolls the counter back with the caller and reissues the same number', async () => {
      const s = await school();
      await issueMany(s, 'ADMISSION', 2);
      let issued: string | null = null;
      await expect(
        withTenant(prisma, s.tenantId, async (tx) => {
          issued = (await service.next(tx, 'ADMISSION', year(s.yearId))).value;
          throw new Error('cancelled save');
        }),
      ).rejects.toThrow('cancelled save');
      expect(issued).toBe('00003');
      expect((await counters(s.tenantId)).map((c) => Number(c.lastValue))).toEqual([2]);
      expect((await issue(s, 'ADMISSION', year(s.yearId))).value).toBe('00003');
    });

    it('restarts per-year series in a new year and keeps counting the others', async () => {
      const s = await school();
      await issueMany(s, 'ENQUIRY', 2);
      await issueMany(s, 'ADMISSION', 3);
      const next = await h.year(s.tenantId, 2027, 'PLANNED');
      const res = await h.post(`/school/academic-years/${next}/make-current`, s.admin.cookie);
      expect(res.status).toBe(200);

      expect((await issue(s, 'ENQUIRY', year(next, 2027))).value).toBe('ENQ/2027-28/0001');
      expect((await issue(s, 'ADMISSION', year(next, 2027))).value).toBe('00004');
      expect(await one(s, 'ENQUIRY')).toMatchObject({ preview: 'ENQ/2027-28/0002' });
    });

    it('throws NumberSeriesExhausted past 99,999,999', async () => {
      const s = await school();
      expect((await patch(s, 'ADMISSION', { nextNumber: 99_999_999 })).status).toBe(200);
      expect((await issue(s, 'ADMISSION', year(s.yearId))).value).toBe('99999999');
      await expect(issue(s, 'ADMISSION', year(s.yearId))).rejects.toBeInstanceOf(
        NumberSeriesExhausted,
      );
      expect(Number((await counters(s.tenantId))[0]!.lastValue)).toBe(99_999_999);
    });

    it("leaves another school's counters alone", async () => {
      const a = await school();
      const b = await school();
      await issueMany(a, 'ENQUIRY', 3);
      await issueMany(a, 'ADMISSION', 2);
      expect(await counters(b.tenantId)).toEqual([]);
      expect((await issue(b, 'ENQUIRY', year(b.yearId))).value).toBe('ENQ/2026-27/0001');
      expect((await list(b)).map((x) => x.nextNumber)).toEqual([2, 1, 1, 1]);
    });
  });

  describe('changing a series', () => {
    it('sets the next number, and refuses one not above the last issued', async () => {
      const s = await school();
      const res = await patch(s, 'ADMISSION', { nextNumber: 4813 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ key: 'ADMISSION', nextNumber: 4813, preview: '04813' });
      expect((await issue(s, 'ADMISSION', year(s.yearId))).value).toBe('04813');

      const again = await patch(s, 'ADMISSION', { nextNumber: 4813 });
      expect(again.status).toBe(422);
      expect(again.body as ProblemBody).toMatchObject({
        type: 'next-number-too-low',
        minimum: 4814,
      });
    });

    it("sets the next number of a per-year series for the current year's period", async () => {
      const s = await school();
      expect((await patch(s, 'ENQUIRY', { nextNumber: 50 })).status).toBe(200);
      expect((await issue(s, 'ENQUIRY', year(s.yearId))).value).toBe('ENQ/2026-27/0050');
    });

    it('refuses a next number for a per-year series without a current year', async () => {
      const s = await school(false);
      const res = await patch(s, 'ENQUIRY', { nextNumber: 50 });
      expect(res.status).toBe(409);
      expect((res.body as ProblemBody).type).toBe('no-current-year');
    });

    it('changes the pattern for numbers issued afterwards', async () => {
      const s = await school();
      await issueMany(s, 'ADMISSION', 2);
      const res = await patch(s, 'ADMISSION', { pattern: 'ADM/{YY}/{SEQ:4}' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ pattern: 'ADM/{YY}/{SEQ:4}', preview: 'ADM/26/0003' });
      expect((await issue(s, 'ADMISSION', year(s.yearId))).value).toBe('ADM/26/0003');
    });

    it.each([
      ['ADM/{XX}/{SEQ:4}', 'unknown-token'],
      ['ADM', 'seq-missing'],
      ['ADM#{SEQ:4}', 'bad-character'],
      ['{SEQ:9}', 'seq-width'],
      ['', 'empty'],
    ])('refuses the pattern %j with 422 number-pattern-invalid (%s)', async (pattern, problem) => {
      const s = await school();
      const res = await patch(s, 'ADMISSION', { pattern });
      expect(res.status).toBe(422);
      expect(res.body as ProblemBody).toMatchObject({ type: 'number-pattern-invalid', problem });
      expect((await one(s, 'ADMISSION')).pattern).toBe('{SEQ:5}');
    });

    it('gives 404 for an unknown key and 400 for an empty or unknown body', async () => {
      const s = await school();
      expect((await patch(s, 'INVOICE', { nextNumber: 5 })).status).toBe(404);
      expect((await patch(s, 'ADMISSION', {})).status).toBe(400);
      expect((await patch(s, 'ADMISSION', { nextNumber: 5, colour: 'red' })).status).toBe(400);
      expect((await patch(s, 'ADMISSION', { nextNumber: 100_000_000 })).status).toBe(400);
    });
  });

  describe('switching the reset rule', () => {
    it('refuses a pattern-only change that removes the year token from a yearly series', async () => {
      const s = await school();
      const res = await patch(s, 'ENQUIRY', { pattern: 'ENQ-{SEQ:4}' });
      expect(res.status).toBe(422);
      expect(res.body as ProblemBody).toMatchObject({
        type: 'number-pattern-invalid',
        problem: 'year-token-required',
      });
      expect((await one(s, 'ENQUIRY')).pattern).toBe('ENQ/{AY}/{SEQ:4}');
    });

    it('refuses a reset-only switch to ACADEMIC_YEAR on a pattern without a year token', async () => {
      const s = await school();
      const res = await patch(s, 'ADMISSION', { reset: 'ACADEMIC_YEAR' });
      expect(res.status).toBe(422);
      expect(res.body as ProblemBody).toMatchObject({
        type: 'number-pattern-invalid',
        problem: 'year-token-required',
      });
      expect((await one(s, 'ADMISSION')).reset).toBe('NEVER');
      expect(await h.audits(s.tenantId, 'number_series')).toEqual([]);
    });

    it('continues a NEVER series in the year when switched to ACADEMIC_YEAR', async () => {
      const s = await school();
      expect((await patch(s, 'ADMISSION', { pattern: 'ADM/{YY}/{SEQ:4}' })).status).toBe(200);
      await issueMany(s, 'ADMISSION', 5);
      const res = await patch(s, 'ADMISSION', { reset: 'ACADEMIC_YEAR' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ nextNumber: 6, preview: 'ADM/26/0006' });
      expect((await issue(s, 'ADMISSION', year(s.yearId))).value).toBe('ADM/26/0006');
    });

    it('never repeats a number on a round trip ACADEMIC_YEAR -> NEVER -> ACADEMIC_YEAR', async () => {
      const s = await school();
      await issueMany(s, 'ENQUIRY', 7);
      const toNever = await patch(s, 'ENQUIRY', { reset: 'NEVER' });
      expect(toNever.body).toMatchObject({ nextNumber: 8, preview: 'ENQ/2026-27/0008' });
      expect(await issueMany(s, 'ENQUIRY', 3)).toEqual([
        'ENQ/2026-27/0008',
        'ENQ/2026-27/0009',
        'ENQ/2026-27/0010',
      ]);
      const back = await patch(s, 'ENQUIRY', { reset: 'ACADEMIC_YEAR' });
      expect(back.status).toBe(200);
      expect(back.body).toMatchObject({ nextNumber: 11, preview: 'ENQ/2026-27/0011' });
      expect((await issue(s, 'ENQUIRY', year(s.yearId))).value).toBe('ENQ/2026-27/0011');
    });

    it('continues a NEVER series from the highest issued in any year after a round trip', async () => {
      const s = await school();
      expect((await patch(s, 'ADMISSION', { pattern: 'A/{YY}/{SEQ:4}' })).status).toBe(200);
      await issueMany(s, 'ADMISSION', 2);
      expect((await patch(s, 'ADMISSION', { reset: 'ACADEMIC_YEAR' })).status).toBe(200);
      expect(await issueMany(s, 'ADMISSION', 3)).toEqual(['A/26/0003', 'A/26/0004', 'A/26/0005']);
      const back = await patch(s, 'ADMISSION', { reset: 'NEVER' });
      expect(back.body).toMatchObject({ reset: 'NEVER', nextNumber: 6, preview: 'A/26/0006' });
    });

    it('refuses a switch to ACADEMIC_YEAR without a current year once numbers were issued', async () => {
      const s = await school(false);
      expect((await patch(s, 'ADMISSION', { pattern: 'A/{YY}/{SEQ:4}' })).status).toBe(200);
      const fresh = await patch(s, 'ADMISSION', { reset: 'ACADEMIC_YEAR' });
      expect(fresh.status).toBe(200);
      expect((await patch(s, 'ADMISSION', { reset: 'NEVER' })).status).toBe(200);
      await issue(s, 'ADMISSION', year(await h.year(s.tenantId, 2025, 'CLOSED'), 2025));
      const res = await patch(s, 'ADMISSION', { reset: 'ACADEMIC_YEAR' });
      expect(res.status).toBe(409);
      expect((res.body as ProblemBody).type).toBe('no-current-year');
      expect((await one(s, 'ADMISSION')).reset).toBe('NEVER');
    });

    it('never repeats a number when a switch to NEVER races with issuing', async () => {
      const s = await school();
      await issueMany(s, 'ENQUIRY', 5);
      const [switched, ...issued] = await Promise.all([
        patch(s, 'ENQUIRY', { reset: 'NEVER' }),
        ...Array.from({ length: 10 }, () => issue(s, 'ENQUIRY', year(s.yearId))),
      ]);
      expect(switched.status).toBe(200);
      const later = await Promise.all(
        Array.from({ length: 5 }, () => issue(s, 'ENQUIRY', year(s.yearId))),
      );
      const sequences = [...issued, ...later].map((r) => (r as { sequence: number }).sequence);
      expect(new Set(sequences).size).toBe(15);
      expect(sequences.sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 6));
    });

    it('continues a per-year series from the highest year when switched to NEVER', async () => {
      const s = await school();
      await issueMany(s, 'ENQUIRY', 7);
      const res = await patch(s, 'ENQUIRY', { reset: 'NEVER' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ nextNumber: 8, preview: 'ENQ/2026-27/0008' });
    });

    it('checks a next number sent with the switch against the new period', async () => {
      const s = await school();
      await issueMany(s, 'ADMISSION', 5);
      const low = await patch(s, 'ADMISSION', {
        reset: 'ACADEMIC_YEAR',
        pattern: 'A/{YY}/{SEQ:4}',
        nextNumber: 5,
      });
      expect(low.status).toBe(422);
      expect(low.body as ProblemBody).toMatchObject({ type: 'next-number-too-low', minimum: 6 });
      expect((await one(s, 'ADMISSION')).reset).toBe('NEVER');
    });
  });

  describe('audit', () => {
    it('writes one number_series.updated row per change with the key and the changed fields', async () => {
      const s = await school();
      await patch(s, 'ADMISSION', { pattern: 'ADM-{SEQ:5}', nextNumber: 100 });
      await patch(s, 'ENQUIRY', { reset: 'NEVER' });
      const rows = await h.audits(s.tenantId, 'number_series');
      expect(rows.map((r) => [r.action, r.targetId, r.before, r.after])).toEqual([
        [
          'number_series.updated',
          s.tenantId,
          { key: 'ADMISSION', pattern: '{SEQ:5}', nextNumber: 1 },
          { key: 'ADMISSION', pattern: 'ADM-{SEQ:5}', nextNumber: 100 },
        ],
        [
          'number_series.updated',
          s.tenantId,
          { key: 'ENQUIRY', reset: 'ACADEMIC_YEAR' },
          { key: 'ENQUIRY', reset: 'NEVER' },
        ],
      ]);
      expect(rows[0]!.actorUserId).toBe(s.admin.userId);
    });

    it('writes nothing for a change that alters nothing', async () => {
      const s = await school();
      const res = await patch(s, 'ADMISSION', {
        pattern: '{SEQ:5}',
        reset: 'NEVER',
        nextNumber: 1,
      });
      expect(res.status).toBe(200);
      expect(await h.audits(s.tenantId, 'number_series')).toEqual([]);
      expect(await counters(s.tenantId)).toEqual([]);
    });
  });

  describe('permissions', () => {
    it('needs settings.manage to change a series', async () => {
      const s = await school();
      const viewer = await custom(s, ['settings.view']);
      expect((await h.get(BASE, viewer)).status).toBe(200);
      const res = await patch(s, 'ADMISSION', { nextNumber: 10 }, viewer);
      expect(res.status).toBe(403);
      expect((res.body as ProblemBody).type).toBe('permission-denied');
    });

    it('needs settings.view to read the series', async () => {
      const s = await school();
      const outsider = await custom(s, ['classes.view']);
      const res = await h.get(BASE, outsider);
      expect(res.status).toBe(403);
      expect((res.body as ProblemBody).type).toBe('permission-denied');
    });
  });
});
