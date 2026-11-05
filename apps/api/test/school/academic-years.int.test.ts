import { academicYearSchema, academicYearsResponseSchema } from '@classloom/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import { SessionService } from '../../src/modules/auth/session.service';
import { addMember, seedSchool } from '../auth/helpers';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';

const WEB_ORIGIN = 'http://localhost:3000';
const COOKIE = 'cl_session';
const BASE = '/school/academic-years';

/** 2026–27, April to March, with the default three terms. */
const APR_2026 = { startsOn: '2026-04-01', endsOn: '2027-03-31', termCount: 3 };
const APR_2027 = { startsOn: '2027-04-01', endsOn: '2028-03-31', termCount: 3 };
const APR_2028 = { startsOn: '2028-04-01', endsOn: '2029-03-31', termCount: 3 };

const THREE_TERMS_2026 = [
  { seq: 1, name: 'Term 1', startsOn: '2026-04-01', endsOn: '2026-07-31' },
  { seq: 2, name: 'Term 2', startsOn: '2026-08-01', endsOn: '2026-11-30' },
  { seq: 3, name: 'Term 3', startsOn: '2026-12-01', endsOn: '2027-03-31' },
];

interface Problem {
  type?: string;
  errors?: { path: string }[];
}
const problem = (res: request.Response) => res.body as Problem;
const year = (res: request.Response) => academicYearSchema.parse(res.body);
const withoutIds = (terms: { id: string }[]) => terms.map(({ id: _id, ...rest }) => rest);

describe('academic years API', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let sessions: SessionService;
  let counter = 0;

  /** A seeded school with an Admin and a Teacher (no years yet). */
  async function school() {
    counter += 1;
    const code = `YRS${counter}`;
    const ids = await seedSchool(owner, { code, email: `o${counter}@years.test` });
    await owner.role.updateMany({
      where: { tenantId: ids.tenantId, key: 'ADMIN' },
      data: { requiresTwoFactor: false },
    });
    const person = async (roleKey: string) => {
      counter += 1;
      const user = await owner.user.create({
        data: { email: `p${counter}@years.test`, name: `Person ${counter}` },
      });
      const m = await addMember(owner, ids.tenantId, user.id, roleKey);
      const { token } = await sessions.create({
        tenantId: ids.tenantId,
        userId: user.id,
        membershipId: m.id,
        remember: false,
      });
      return { userId: user.id, cookie: `${COOKIE}=${token}` };
    };
    return {
      tenantId: ids.tenantId,
      admin: await person('ADMIN'),
      teacher: await person('TEACHER'),
    };
  }

  const get = (path: string, cookie: string) => request(server).get(path).set('Cookie', cookie);
  const post = (path: string, cookie: string) =>
    request(server).post(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN);
  const patch = (path: string, cookie: string) =>
    request(server).patch(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN);
  const del = (path: string, cookie: string) =>
    request(server).delete(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN);

  const create = async (cookie: string, body: object) => {
    const res = await post(BASE, cookie).send(body);
    expect(res.status).toBe(201);
    return year(res);
  };
  const audits = (tenantId: string) =>
    owner.auditEvent.findMany({
      where: { tenantId, targetType: 'academic_year' },
      orderBy: { createdAt: 'asc' },
    });
  const yearRows = (tenantId: string) =>
    owner.academicYear.findMany({ where: { tenantId }, include: { terms: true } });

  beforeAll(async () => {
    infra = await startTestInfra();
    app = await createApp(infra.env, { logger: false });
    await app.init();
    server = app.getHttpServer() as App;
    owner = ownerPrisma(infra.env);
    sessions = app.get(SessionService);
  });

  afterAll(async () => {
    await owner?.$disconnect();
    await app?.close();
    await infra?.stop();
  });

  describe('POST', () => {
    it('makes the first year CURRENT with the default label and terms, and one audit row', async () => {
      const s = await school();
      const res = await post(BASE, s.admin.cookie).send(APR_2026);
      expect(res.status).toBe(201);
      const y = year(res);
      expect(y).toMatchObject({
        label: '2026–27',
        startsOn: '2026-04-01',
        endsOn: '2027-03-31',
        status: 'CURRENT',
      });
      expect(withoutIds(y.terms)).toEqual(THREE_TERMS_2026);
      const events = await audits(s.tenantId);
      expect(events.map((e) => [e.action, e.targetId])).toEqual([['academic_year.created', y.id]]);
      expect(events[0]!.actorUserId).toBe(s.admin.userId);
    });

    it('makes a second, later year PLANNED', async () => {
      const s = await school();
      await create(s.admin.cookie, APR_2026);
      const next = await create(s.admin.cookie, APR_2027);
      expect(next.status).toBe('PLANNED');
      expect(next.label).toBe('2027–28');
    });

    it('refuses a third year with 409 academic-year-planned-exists', async () => {
      const s = await school();
      await create(s.admin.cookie, APR_2026);
      await create(s.admin.cookie, APR_2027);
      const res = await post(BASE, s.admin.cookie).send(APR_2028);
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('academic-year-planned-exists');
      expect(await yearRows(s.tenantId)).toHaveLength(2);
    });

    it('refuses an overlapping year with 409 academic-year-overlap', async () => {
      const s = await school();
      await create(s.admin.cookie, APR_2026);
      const res = await post(BASE, s.admin.cookie).send({
        startsOn: '2027-01-01',
        endsOn: '2027-12-31',
        termCount: 2,
      });
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('academic-year-overlap');
      expect(await yearRows(s.tenantId)).toHaveLength(1);
    });

    it('refuses terms with a gap with 422 academic-terms-invalid and the index', async () => {
      const s = await school();
      const res = await post(BASE, s.admin.cookie).send({
        startsOn: '2026-04-01',
        endsOn: '2027-03-31',
        terms: [
          { name: 'Term 1', startsOn: '2026-04-01', endsOn: '2026-09-30' },
          { name: 'Term 2', startsOn: '2026-10-02', endsOn: '2027-03-31' },
        ],
      });
      expect(res.status).toBe(422);
      expect(problem(res).type).toBe('academic-terms-invalid');
      expect(problem(res).errors).toEqual([expect.objectContaining({ path: 'terms.1' })]);
      expect(await yearRows(s.tenantId)).toHaveLength(0);
      expect(await audits(s.tenantId)).toHaveLength(0);
    });

    it('refuses a 179-day year with 400', async () => {
      const s = await school();
      const res = await post(BASE, s.admin.cookie).send({
        startsOn: '2026-04-01',
        endsOn: '2026-09-27',
        termCount: 2,
      });
      expect(res.status).toBe(400);
    });

    it('splits a June–May year into Jun–Nov and Dec–May with termCount 2', async () => {
      const s = await school();
      const y = await create(s.admin.cookie, {
        startsOn: '2026-06-01',
        endsOn: '2027-05-31',
        termCount: 2,
      });
      expect(withoutIds(y.terms)).toEqual([
        { seq: 1, name: 'Term 1', startsOn: '2026-06-01', endsOn: '2026-11-30' },
        { seq: 2, name: 'Term 2', startsOn: '2026-12-01', endsOn: '2027-05-31' },
      ]);
    });

    it('keeps the given label and terms', async () => {
      const s = await school();
      const y = await create(s.admin.cookie, {
        label: 'Session 26',
        startsOn: '2026-04-01',
        endsOn: '2027-03-31',
        terms: [
          { name: 'First', startsOn: '2026-04-01', endsOn: '2026-10-15' },
          { name: 'Second', startsOn: '2026-10-16', endsOn: '2027-03-31' },
        ],
      });
      expect(y.label).toBe('Session 26');
      expect(y.terms.map((t) => [t.seq, t.name])).toEqual([
        [1, 'First'],
        [2, 'Second'],
      ]);
    });

    it('refuses a label differing only in case with 409 academic-year-label-taken', async () => {
      const s = await school();
      await create(s.admin.cookie, { ...APR_2026, label: 'Session A' });
      const res = await post(BASE, s.admin.cookie).send({ ...APR_2027, label: 'SESSION a' });
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('academic-year-label-taken');
    });

    it('refuses a planned year before the current year with 409 academic-year-overlap', async () => {
      const s = await school();
      await create(s.admin.cookie, APR_2027);
      const res = await post(BASE, s.admin.cookie).send(APR_2026);
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('academic-year-overlap');
      expect(await yearRows(s.tenantId)).toHaveLength(1);
    });

    it('accepts the planned year that starts the day after the current year ends', async () => {
      const s = await school();
      await create(s.admin.cookie, APR_2026);
      const next = await create(s.admin.cookie, APR_2027);
      expect(next).toMatchObject({ status: 'PLANNED', startsOn: '2027-04-01' });
    });

    it("refuses a Teacher's create with 403", async () => {
      const s = await school();
      const res = await post(BASE, s.teacher.cookie).send(APR_2026);
      expect(res.status).toBe(403);
      expect(problem(res).type).toBe('permission-denied');
    });
  });

  describe('GET', () => {
    it('lets a Teacher list the years, newest first, with their terms', async () => {
      const s = await school();
      await create(s.admin.cookie, APR_2026);
      await create(s.admin.cookie, APR_2027);
      const res = await get(BASE, s.teacher.cookie);
      expect(res.status).toBe(200);
      const { years } = academicYearsResponseSchema.parse(res.body);
      expect(years.map((y) => y.label)).toEqual(['2027–28', '2026–27']);
      expect(withoutIds(years[1]!.terms)).toEqual(THREE_TERMS_2026);
    });

    it("never shows another school's years", async () => {
      const a = await school();
      const b = await school();
      await create(a.admin.cookie, APR_2026);
      const res = await get(BASE, b.teacher.cookie);
      expect(academicYearsResponseSchema.parse(res.body).years).toEqual([]);
    });
  });

  describe('PATCH', () => {
    it('replaces the dates, label and terms in one change with one audit row', async () => {
      const s = await school();
      const y = await create(s.admin.cookie, APR_2026);
      const res = await patch(`${BASE}/${y.id}`, s.admin.cookie).send({
        label: '2026–27 (revised)',
        startsOn: '2026-04-01',
        endsOn: '2027-04-30',
        terms: [
          { name: 'Half 1', startsOn: '2026-04-01', endsOn: '2026-10-31' },
          { name: 'Half 2', startsOn: '2026-11-01', endsOn: '2027-04-30' },
        ],
      });
      expect(res.status).toBe(200);
      const updated = year(res);
      expect(updated).toMatchObject({ label: '2026–27 (revised)', endsOn: '2027-04-30' });
      expect(withoutIds(updated.terms)).toEqual([
        { seq: 1, name: 'Half 1', startsOn: '2026-04-01', endsOn: '2026-10-31' },
        { seq: 2, name: 'Half 2', startsOn: '2026-11-01', endsOn: '2027-04-30' },
      ]);
      const rows = await yearRows(s.tenantId);
      expect(rows[0]!.terms).toHaveLength(2);
      const events = await audits(s.tenantId);
      expect(events.map((e) => e.action)).toEqual([
        'academic_year.created',
        'academic_year.updated',
      ]);
      expect(events[1]!.before).toMatchObject({ label: '2026–27', endsOn: '2027-03-31' });
      expect(events[1]!.after).toMatchObject({ label: '2026–27 (revised)', endsOn: '2027-04-30' });
    });

    it('refuses a new end date the terms do not reach with 422, changing nothing', async () => {
      const s = await school();
      const y = await create(s.admin.cookie, APR_2026);
      const res = await patch(`${BASE}/${y.id}`, s.admin.cookie).send({
        startsOn: '2026-04-01',
        endsOn: '2027-04-30',
        terms: THREE_TERMS_2026.map(({ seq: _seq, ...t }) => t),
      });
      expect(res.status).toBe(422);
      expect(problem(res).type).toBe('academic-terms-invalid');
      expect(problem(res).errors).toEqual([expect.objectContaining({ path: 'terms.2' })]);
      const after = (await get(BASE, s.admin.cookie)).body as { years: unknown[] };
      expect(after.years).toEqual([y]);
      expect(await audits(s.tenantId)).toHaveLength(1);
    });

    it('refuses dates that overlap another year with 409 academic-year-overlap', async () => {
      const s = await school();
      await create(s.admin.cookie, APR_2026);
      const next = await create(s.admin.cookie, APR_2027);
      const res = await patch(`${BASE}/${next.id}`, s.admin.cookie).send({
        startsOn: '2027-03-01',
        endsOn: '2028-03-31',
        terms: [
          { name: 'Term 1', startsOn: '2027-03-01', endsOn: '2027-09-30' },
          { name: 'Term 2', startsOn: '2027-10-01', endsOn: '2028-03-31' },
        ],
      });
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('academic-year-overlap');
    });

    it('refuses taking another year label (case-insensitive) with 409', async () => {
      const s = await school();
      await create(s.admin.cookie, APR_2026);
      const next = await create(s.admin.cookie, APR_2027);
      const res = await patch(`${BASE}/${next.id}`, s.admin.cookie).send({
        label: '2026–27'.toUpperCase(),
        startsOn: next.startsOn,
        endsOn: next.endsOn,
        terms: next.terms.map(({ name, startsOn, endsOn }) => ({ name, startsOn, endsOn })),
      });
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('academic-year-label-taken');
    });

    const CAL_2027 = {
      startsOn: '2027-01-01',
      endsOn: '2027-12-31',
      terms: [
        { name: 'Term 1', startsOn: '2027-01-01', endsOn: '2027-06-30' },
        { name: 'Term 2', startsOn: '2027-07-01', endsOn: '2027-12-31' },
      ],
    };

    it('moves an automatic label with the dates when no label is sent', async () => {
      const s = await school();
      const y = await create(s.admin.cookie, APR_2026);
      const res = await patch(`${BASE}/${y.id}`, s.admin.cookie).send(CAL_2027);
      expect(res.status).toBe(200);
      expect(year(res).label).toBe('2027');
    });

    it('keeps a custom label when the dates move and no label is sent', async () => {
      const s = await school();
      const y = await create(s.admin.cookie, { ...APR_2026, label: 'Session 26' });
      const res = await patch(`${BASE}/${y.id}`, s.admin.cookie).send(CAL_2027);
      expect(res.status).toBe(200);
      expect(year(res).label).toBe('Session 26');
    });

    it('refuses moving the planned year before the current year with 409, changing nothing', async () => {
      const s = await school();
      await create(s.admin.cookie, APR_2027);
      const next = await create(s.admin.cookie, {
        startsOn: '2028-04-01',
        endsOn: '2029-03-31',
        termCount: 2,
      });
      const res = await patch(`${BASE}/${next.id}`, s.admin.cookie).send({
        startsOn: '2026-04-01',
        endsOn: '2027-03-31',
        terms: THREE_TERMS_2026.map(({ seq: _seq, ...t }) => t),
      });
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('academic-year-overlap');
      const rows = await owner.academicYear.findUnique({ where: { id: next.id } });
      expect(rows?.startsOn.toISOString().slice(0, 10)).toBe('2028-04-01');
    });

    it("gives 404 for another school's year", async () => {
      const a = await school();
      const b = await school();
      const y = await create(a.admin.cookie, APR_2026);
      const res = await patch(`${BASE}/${y.id}`, b.admin.cookie).send({
        startsOn: '2026-04-01',
        endsOn: '2027-03-31',
        terms: THREE_TERMS_2026.map(({ seq: _seq, ...t }) => t),
      });
      expect(res.status).toBe(404);
      expect((await yearRows(a.tenantId))[0]!.terms).toHaveLength(3);
    });

    it('gives 404 for an id that is not a uuid', async () => {
      const s = await school();
      const res = await patch(`${BASE}/not-a-uuid`, s.admin.cookie).send({
        startsOn: '2026-04-01',
        endsOn: '2027-03-31',
        terms: THREE_TERMS_2026.map(({ seq: _seq, ...t }) => t),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('make current', () => {
    it('turns PLANNED into CURRENT and the old CURRENT into CLOSED, with one audit row', async () => {
      const s = await school();
      const first = await create(s.admin.cookie, APR_2026);
      const next = await create(s.admin.cookie, APR_2027);
      const res = await post(`${BASE}/${next.id}/make-current`, s.admin.cookie);
      expect(res.status).toBe(200);
      expect(year(res)).toMatchObject({ id: next.id, status: 'CURRENT' });
      const { years } = academicYearsResponseSchema.parse((await get(BASE, s.admin.cookie)).body);
      expect(years.map((y) => [y.id, y.status])).toEqual([
        [next.id, 'CURRENT'],
        [first.id, 'CLOSED'],
      ]);
      const made = (await audits(s.tenantId)).filter(
        (e) => e.action === 'academic_year.made_current',
      );
      expect(made).toHaveLength(1);
      expect(made[0]!.targetId).toBe(next.id);
      expect(made[0]!.before).toEqual({ currentYearId: first.id, plannedYearId: next.id });
      expect(made[0]!.after).toEqual({ currentYearId: next.id, closedYearId: first.id });
    });

    it('serialises two simultaneous calls: one 200, one 409, one CURRENT year', async () => {
      const s = await school();
      await create(s.admin.cookie, APR_2026);
      const next = await create(s.admin.cookie, APR_2027);
      const results = await Promise.all([
        post(`${BASE}/${next.id}/make-current`, s.admin.cookie),
        post(`${BASE}/${next.id}/make-current`, s.admin.cookie),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const loser = results.find((r) => r.status === 409)!;
      expect(problem(loser).type).toBe('academic-year-locked');
      const rows = await yearRows(s.tenantId);
      expect(rows.filter((r) => r.status === 'CURRENT').map((r) => r.id)).toEqual([next.id]);
      const made = (await audits(s.tenantId)).filter(
        (e) => e.action === 'academic_year.made_current',
      );
      expect(made).toHaveLength(1);
    });

    it('refuses the CURRENT year with 409 academic-year-locked', async () => {
      const s = await school();
      const first = await create(s.admin.cookie, APR_2026);
      const res = await post(`${BASE}/${first.id}/make-current`, s.admin.cookie);
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('academic-year-locked');
    });
  });

  describe('CLOSED and CURRENT years', () => {
    async function withClosedYear() {
      const s = await school();
      const closed = await create(s.admin.cookie, APR_2026);
      const next = await create(s.admin.cookie, APR_2027);
      expect((await post(`${BASE}/${next.id}/make-current`, s.admin.cookie)).status).toBe(200);
      return { s, closed, current: next };
    }

    it('refuses PATCH, make-current and DELETE on a CLOSED year with 409 locked', async () => {
      const { s, closed } = await withClosedYear();
      const before = await audits(s.tenantId);
      const edit = await patch(`${BASE}/${closed.id}`, s.admin.cookie).send({
        label: 'Renamed',
        startsOn: closed.startsOn,
        endsOn: closed.endsOn,
        terms: closed.terms.map(({ name, startsOn, endsOn }) => ({ name, startsOn, endsOn })),
      });
      const makeCurrent = await post(`${BASE}/${closed.id}/make-current`, s.admin.cookie);
      const remove = await del(`${BASE}/${closed.id}`, s.admin.cookie);
      for (const res of [edit, makeCurrent, remove]) {
        expect(res.status).toBe(409);
        expect(problem(res).type).toBe('academic-year-locked');
      }
      expect(await audits(s.tenantId)).toHaveLength(before.length);
    });

    it('refuses DELETE on the CURRENT year with 409 locked', async () => {
      const { s, current } = await withClosedYear();
      const res = await del(`${BASE}/${current.id}`, s.admin.cookie);
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('academic-year-locked');
    });

    it('deletes a PLANNED year with 204, its terms cascading, and one audit row', async () => {
      const s = await school();
      await create(s.admin.cookie, APR_2026);
      const next = await create(s.admin.cookie, APR_2027);
      const res = await del(`${BASE}/${next.id}`, s.admin.cookie);
      expect(res.status).toBe(204);
      expect(await owner.academicYear.findUnique({ where: { id: next.id } })).toBeNull();
      expect(await owner.academicTerm.count({ where: { academicYearId: next.id } })).toBe(0);
      const events = await audits(s.tenantId);
      expect(events.map((e) => [e.action, e.targetId])).toEqual([
        ['academic_year.created', expect.any(String)],
        ['academic_year.created', next.id],
        ['academic_year.deleted', next.id],
      ]);
    });

    it('refuses DELETE on a PLANNED year with sections with 409 in-use, keeping them', async () => {
      const s = await school();
      await create(s.admin.cookie, APR_2026);
      const next = await create(s.admin.cookie, APR_2027);
      const campus = await owner.campus.findFirstOrThrow({
        where: { tenantId: s.tenantId, isPrimary: true },
      });
      // As copy forward leaves them: two sections already in the planned year.
      await owner.section.createMany({
        data: ['A', 'B'].map((name) => ({
          tenantId: s.tenantId,
          academicYearId: next.id,
          campusId: campus.id,
          classLevel: 'I' as const,
          name,
          capacity: 40,
        })),
      });
      const before = await audits(s.tenantId);
      const res = await del(`${BASE}/${next.id}`, s.admin.cookie);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ type: 'in-use', counts: { sections: 2 } });
      expect(await owner.section.count({ where: { academicYearId: next.id } })).toBe(2);
      expect(await owner.academicYear.findUnique({ where: { id: next.id } })).not.toBeNull();
      expect(await audits(s.tenantId)).toHaveLength(before.length);

      await owner.section.deleteMany({ where: { academicYearId: next.id } });
      expect((await del(`${BASE}/${next.id}`, s.admin.cookie)).status).toBe(204);
      expect(await owner.academicYear.findUnique({ where: { id: next.id } })).toBeNull();
    });
  });
});
