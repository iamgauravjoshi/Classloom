import {
  classTeacherOptionsResponseSchema,
  copySectionsResponseSchema,
  type Section,
  sectionSchema,
  sectionsResponseSchema,
} from '@classloom/contracts';
import type request from 'supertest';

import { academicsHarness, type AcademicsSchool, problem } from './helpers';

const BASE = '/academics/sections';
const section = (res: request.Response) => sectionSchema.parse(res.body);
const sections = (res: request.Response) => sectionsResponseSchema.parse(res.body).sections;

describe('sections API', () => {
  const h = academicsHarness('SEC');

  beforeAll(() => h.start());
  afterAll(() => h.stop());

  /** A school with a CURRENT 2026-27 year. */
  const setup = async (range?: Parameters<typeof h.school>[0]) => {
    const s = await h.school(range);
    const year = await h.year(s.tenantId, 2026, 'CURRENT');
    return { s, year };
  };

  const body = (s: AcademicsSchool, year: string, extra: Record<string, unknown> = {}) => ({
    academicYearId: year,
    campusId: s.primaryCampusId,
    classLevel: 'VI',
    name: 'A',
    capacity: 40,
    ...extra,
  });

  const create = async (
    s: AcademicsSchool,
    year: string,
    extra: Record<string, unknown> = {},
  ): Promise<Section> => {
    const res = await h.post(BASE, s.admin.cookie).send(body(s, year, extra));
    expect(res.status).toBe(201);
    return section(res);
  };

  const room = async (s: AcademicsSchool, name: string, campusId = s.primaryCampusId) =>
    (
      await h.owner.room.create({
        data: { tenantId: s.tenantId, campusId, name, type: 'CLASSROOM', capacity: 40 },
      })
    ).id;

  const stream = async (s: AcademicsSchool, name: string) =>
    (await h.owner.stream.create({ data: { tenantId: s.tenantId, name } })).id;

  const deactivate = (membershipId: string) =>
    h.owner.membership.update({
      where: { id: membershipId },
      data: { status: 'DEACTIVATED', deactivatedAt: new Date() },
    });

  const list = (s: AcademicsSchool, year: string, campusId = s.primaryCampusId) =>
    h.get(`${BASE}?yearId=${year}&campusId=${campusId}`, s.admin.cookie);

  describe('creating', () => {
    it('creates VI-A with a room and a teacher, with one section.created row', async () => {
      const { s, year } = await setup();
      const r = await room(s, '101');
      const a = await create(s, year, {
        name: ' A ',
        roomId: r,
        classTeacherMembershipId: s.teacher.membershipId,
      });
      expect(a).toMatchObject({
        academicYearId: year,
        campusId: s.primaryCampusId,
        classLevel: 'VI',
        outsideRange: false,
        name: 'A',
        capacity: 40,
        stream: null,
        room: { id: r, name: '101' },
        classTeacher: { membershipId: s.teacher.membershipId, active: true },
      });
      expect(a.classTeacher?.name).toMatch(/^Person /);
      const events = await h.audits(s.tenantId, 'section');
      expect(events.map((e) => e.action)).toEqual(['section.created']);
      expect(events[0]).toMatchObject({ targetId: a.id, actorUserId: s.admin.userId });
      expect(events[0]!.after).toMatchObject({ classLevel: 'VI', name: 'A', roomId: r });
    });

    it('gives 409 teacher-taken with the section name for the same teacher in the same year', async () => {
      const { s, year } = await setup();
      await create(s, year, { classTeacherMembershipId: s.teacher.membershipId });
      const res = await h
        .post(BASE, s.admin.cookie)
        .send(body(s, year, { name: 'B', classTeacherMembershipId: s.teacher.membershipId }));
      expect(res.status).toBe(409);
      expect(problem(res)).toMatchObject({ type: 'teacher-taken', sectionName: 'VI-A' });

      const next = await h.year(s.tenantId, 2027, 'PLANNED');
      await create(s, next, { classTeacherMembershipId: s.teacher.membershipId });
    });

    it('lets only one of two concurrent creates name the same teacher (one 201, one 409)', async () => {
      const { s, year } = await setup();
      const north = await h.campus(s.tenantId, 'North');
      const teacher = { classTeacherMembershipId: s.teacher.membershipId };
      const results = await Promise.all([
        h.post(BASE, s.admin.cookie).send(body(s, year, { classLevel: 'VI', ...teacher })),
        h
          .post(BASE, s.admin.cookie)
          .send(body(s, year, { classLevel: 'VII', campusId: north, ...teacher })),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const refused = results.find((r) => r.status === 409)!;
      expect(problem(refused).type).toBe('teacher-taken');
      expect(
        await h.owner.section.count({
          where: { academicYearId: year, classTeacherMembershipId: s.teacher.membershipId },
        }),
      ).toBe(1);
    });

    it('gives 422 teacher-unavailable for a deactivated member or one of another school', async () => {
      const { s, year } = await setup();
      const other = await h.school();
      await deactivate(s.teacher.membershipId);
      for (const id of [s.teacher.membershipId, other.teacher.membershipId]) {
        const res = await h
          .post(BASE, s.admin.cookie)
          .send(body(s, year, { classTeacherMembershipId: id }));
        expect(res.status).toBe(422);
        expect(problem(res).type).toBe('teacher-unavailable');
      }
    });

    it('gives 422 room-campus-mismatch for a room on another campus', async () => {
      const { s, year } = await setup();
      const north = await h.campus(s.tenantId, 'North');
      const r = await room(s, '101', north);
      const res = await h.post(BASE, s.admin.cookie).send(body(s, year, { roomId: r }));
      expect(res.status).toBe(422);
      expect(problem(res).type).toBe('room-campus-mismatch');

      const a = await create(s, year);
      const edit = await h.patch(`${BASE}/${a.id}`, s.admin.cookie).send({ roomId: r });
      expect(edit.status).toBe(422);
      expect(problem(edit).type).toBe('room-campus-mismatch');
    });

    it('gives 409 classes-not-set without a profile range and 422 class-out-of-range outside it', async () => {
      const unset = await setup(null);
      const res = await h.post(BASE, unset.s.admin.cookie).send(body(unset.s, unset.year));
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('classes-not-set');

      const { s, year } = await setup(['I', 'V']);
      const out = await h.post(BASE, s.admin.cookie).send(body(s, year));
      expect(out.status).toBe(422);
      expect(problem(out).type).toBe('class-out-of-range');
    });

    it('gives 404 for an unknown year or campus', async () => {
      const { s, year } = await setup();
      const other = await h.school();
      const otherYear = await h.year(other.tenantId, 2026, 'CURRENT');
      const r1 = await h.post(BASE, s.admin.cookie).send(body(s, otherYear));
      expect(r1.status).toBe(404);
      const r2 = await h
        .post(BASE, s.admin.cookie)
        .send(body(s, year, { campusId: other.primaryCampusId }));
      expect(r2.status).toBe(404);
    });

    it('ends two concurrent creates of "A" with one 201 and one 409 name-taken', async () => {
      const { s, year } = await setup();
      const results = await Promise.all([
        h.post(BASE, s.admin.cookie).send(body(s, year)),
        h.post(BASE, s.admin.cookie).send(body(s, year, { name: 'a' })),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const conflict = results.find((r) => r.status === 409)!;
      expect(problem(conflict)).toMatchObject({ type: 'name-taken', field: 'name' });
    });

    it('gives 409 academics-limit from the 501st section of a year and campus', async () => {
      const { s, year } = await setup();
      await h.owner.section.createMany({
        data: Array.from({ length: 500 }, (_, i) => ({
          tenantId: s.tenantId,
          academicYearId: year,
          campusId: s.primaryCampusId,
          classLevel: 'VI' as const,
          name: `S${i}`,
          capacity: 40,
        })),
      });
      const res = await h.post(BASE, s.admin.cookie).send(body(s, year, { name: 'One more' }));
      expect(res.status).toBe(409);
      expect(problem(res)).toMatchObject({ type: 'academics-limit', limit: 500 });
    });
  });

  describe('streams', () => {
    it('requires a stream for XI and refuses one for VI while the school has an active stream', async () => {
      const { s, year } = await setup();
      const science = await stream(s, 'Science');
      const missing = await h.post(BASE, s.admin.cookie).send(body(s, year, { classLevel: 'XI' }));
      expect(missing.status).toBe(422);
      expect(problem(missing).type).toBe('stream-required');
      const junior = await h.post(BASE, s.admin.cookie).send(body(s, year, { streamId: science }));
      expect(junior.status).toBe(422);
      expect(problem(junior).type).toBe('stream-not-allowed');
      const ok = await create(s, year, { classLevel: 'XI', streamId: science });
      expect(ok.stream).toEqual({ id: science, name: 'Science' });
    });

    it('refuses an archived stream for a new section', async () => {
      const { s, year } = await setup();
      await stream(s, 'Science');
      const old = await h.owner.stream.create({
        data: { tenantId: s.tenantId, name: 'Arts', status: 'ARCHIVED' },
      });
      const res = await h
        .post(BASE, s.admin.cookie)
        .send(body(s, year, { classLevel: 'XI', streamId: old.id }));
      expect(res.status).toBe(422);
      expect(problem(res).type).toBe('stream-archived');
    });

    it('keeps XI sections made before any stream listed; editing one then asks for a stream', async () => {
      const { s, year } = await setup();
      const xi = await create(s, year, { classLevel: 'XI' });
      expect(xi.stream).toBeNull();
      const science = await stream(s, 'Science');
      expect(sections(await list(s, year)).map((x) => x.id)).toEqual([xi.id]);

      const edit = await h.patch(`${BASE}/${xi.id}`, s.admin.cookie).send({ capacity: 35 });
      expect(edit.status).toBe(422);
      expect(problem(edit).type).toBe('stream-required');
      const fixed = await h
        .patch(`${BASE}/${xi.id}`, s.admin.cookie)
        .send({ capacity: 35, streamId: science });
      expect(fixed.status).toBe(200);
      expect(section(fixed).stream?.id).toBe(science);
    });
  });

  describe('listing', () => {
    it('lists by class level, then name, with room, stream and class teacher state', async () => {
      const { s, year } = await setup();
      const north = await h.campus(s.tenantId, 'North');
      await create(s, year, { classLevel: 'VII', name: 'A' });
      await create(s, year, {
        classLevel: 'VI',
        name: 'B',
        classTeacherMembershipId: s.teacher.membershipId,
      });
      await create(s, year, { classLevel: 'VI', name: 'A' });
      await create(s, year, { campusId: north, name: 'Z' });
      await deactivate(s.teacher.membershipId);

      const rows = sections(await list(s, year));
      expect(rows.map((x) => `${x.classLevel} ${x.name}`)).toEqual(['VI A', 'VI B', 'VII A']);
      expect(rows[1]!.classTeacher).toMatchObject({
        membershipId: s.teacher.membershipId,
        active: false,
      });
    });

    it('gives 400 without yearId or campusId', async () => {
      const { s, year } = await setup();
      expect((await h.get(`${BASE}?yearId=${year}`, s.admin.cookie)).status).toBe(400);
      expect((await h.get(`${BASE}?campusId=${s.primaryCampusId}`, s.admin.cookie)).status).toBe(
        400,
      );
    });
  });

  describe('updating and deleting', () => {
    it('updates with one section.updated row holding only the changed fields', async () => {
      const { s, year } = await setup();
      const a = await create(s, year);
      const r = await room(s, '101');
      const res = await h
        .patch(`${BASE}/${a.id}`, s.admin.cookie)
        .send({ name: 'A', capacity: 30, roomId: r });
      expect(res.status).toBe(200);
      expect(section(res)).toMatchObject({ capacity: 30, room: { id: r } });
      expect((await h.patch(`${BASE}/${a.id}`, s.admin.cookie).send({})).status).toBe(200);
      const updates = (await h.audits(s.tenantId, 'section')).filter(
        (e) => e.action === 'section.updated',
      );
      expect(updates).toHaveLength(1);
      expect(updates[0]!.before).toEqual({ capacity: 40, roomId: null });
      expect(updates[0]!.after).toEqual({ capacity: 30, roomId: r });
    });

    it('lets a section keep its teacher when edited, and clears the teacher with null', async () => {
      const { s, year } = await setup();
      const a = await create(s, year, { classTeacherMembershipId: s.teacher.membershipId });
      const same = await h
        .patch(`${BASE}/${a.id}`, s.admin.cookie)
        .send({ classTeacherMembershipId: s.teacher.membershipId, capacity: 41 });
      expect(same.status).toBe(200);
      const cleared = await h
        .patch(`${BASE}/${a.id}`, s.admin.cookie)
        .send({ classTeacherMembershipId: null });
      expect(cleared.status).toBe(200);
      expect(section(cleared).classTeacher).toBeNull();
    });

    it('deletes with one section.deleted row', async () => {
      const { s, year } = await setup();
      const a = await create(s, year);
      expect((await h.del(`${BASE}/${a.id}`, s.admin.cookie)).status).toBe(204);
      expect(await h.owner.section.count({ where: { tenantId: s.tenantId } })).toBe(0);
      const events = await h.audits(s.tenantId, 'section');
      expect(events.map((e) => e.action)).toEqual(['section.created', 'section.deleted']);
      expect(events[1]!.before).toMatchObject({ classLevel: 'VI', name: 'A' });
    });

    it('marks a section outside a narrowed range; PATCH gives 422, DELETE succeeds', async () => {
      const { s, year } = await setup();
      const xii = await create(s, year, { classLevel: 'XII' });
      await h.owner.schoolProfile.update({
        where: { tenantId: s.tenantId },
        data: { highestClass: 'X' },
      });
      const rows = sections(await list(s, year));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: xii.id, outsideRange: true });
      const edit = await h.patch(`${BASE}/${xii.id}`, s.admin.cookie).send({ capacity: 30 });
      expect(edit.status).toBe(422);
      expect(problem(edit).type).toBe('class-out-of-range');
      expect((await h.del(`${BASE}/${xii.id}`, s.admin.cookie)).status).toBe(204);
    });

    it('refuses every section write in a CLOSED year with 409 academic-year-locked', async () => {
      const { s } = await setup();
      const closed = await h.year(s.tenantId, 2025, 'CLOSED');
      const row = await h.owner.section.create({
        data: {
          tenantId: s.tenantId,
          academicYearId: closed,
          campusId: s.primaryCampusId,
          classLevel: 'VI',
          name: 'A',
          capacity: 40,
        },
      });
      const calls = [
        h.post(BASE, s.admin.cookie).send(body(s, closed, { name: 'B' })),
        h.patch(`${BASE}/${row.id}`, s.admin.cookie).send({ capacity: 30 }),
        h.del(`${BASE}/${row.id}`, s.admin.cookie),
        h
          .post(`${BASE}/copy-from-previous`, s.admin.cookie)
          .send({ yearId: closed, campusId: s.primaryCampusId }),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(409);
        expect(problem(res).type).toBe('academic-year-locked');
      }
      expect(await h.owner.section.count({ where: { tenantId: s.tenantId } })).toBe(1);
      expect(await h.audits(s.tenantId, 'section')).toEqual([]);
    });
  });

  describe('copy forward', () => {
    it('copies the previous year, dropping an archived room and a deactivated teacher', async () => {
      const { s, year } = await setup();
      const north = await h.campus(s.tenantId, 'North');
      const r1 = await room(s, '101');
      const r2 = await room(s, '102');
      const t3 = await s.person('TEACHER');
      await create(s, year, {
        name: 'A',
        roomId: r1,
        classTeacherMembershipId: s.teacher.membershipId,
      });
      await create(s, year, {
        name: 'B',
        roomId: r2,
        classTeacherMembershipId: s.admin.membershipId,
      });
      await create(s, year, {
        classLevel: 'VII',
        name: 'A',
        classTeacherMembershipId: t3.membershipId,
        capacity: 35,
      });
      await create(s, year, { campusId: north, name: 'N' });
      const next = await h.year(s.tenantId, 2027, 'PLANNED');
      await h.post(`/academics/rooms/${r1}/archive`, s.admin.cookie);
      await deactivate(t3.membershipId);
      const before = (await h.audits(s.tenantId)).length;

      const res = await h
        .post(`${BASE}/copy-from-previous`, s.admin.cookie)
        .send({ yearId: next, campusId: s.primaryCampusId });
      expect(res.status).toBe(201);
      const out = copySectionsResponseSchema.parse(res.body);
      expect(out.created).toBe(3);
      expect(out.dropped).toEqual([
        { section: 'VI-A', field: 'room' },
        { section: 'VII-A', field: 'teacher' },
      ]);

      const copied = sections(await list(s, next));
      expect(
        copied.map((x) => [
          x.classLevel,
          x.name,
          x.capacity,
          x.room?.id ?? null,
          x.classTeacher?.membershipId ?? null,
        ]),
      ).toEqual([
        ['VI', 'A', 40, null, s.teacher.membershipId],
        ['VI', 'B', 40, r2, s.admin.membershipId],
        ['VII', 'A', 35, null, null],
      ]);
      expect(sections(await list(s, next, north))).toEqual([]);

      const events = (await h.audits(s.tenantId)).slice(before);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: 'sections.copied',
        targetType: 'academic_year',
        targetId: next,
      });
      expect(events[0]!.after).toMatchObject({ campusId: s.primaryCampusId, created: 3 });

      const again = await h
        .post(`${BASE}/copy-from-previous`, s.admin.cookie)
        .send({ yearId: next, campusId: s.primaryCampusId });
      expect(again.status).toBe(409);
      expect(problem(again).type).toBe('sections-exist');
    });

    it('copies only from the same campus', async () => {
      const { s, year } = await setup();
      const north = await h.campus(s.tenantId, 'North');
      const south = await h.campus(s.tenantId, 'South');
      await create(s, year, { name: 'A' });
      await create(s, year, { campusId: north, name: 'N' });
      const next = await h.year(s.tenantId, 2027, 'PLANNED');
      const res = await h
        .post(`${BASE}/copy-from-previous`, s.admin.cookie)
        .send({ yearId: next, campusId: north });
      expect(res.status).toBe(201);
      expect(copySectionsResponseSchema.parse(res.body).created).toBe(1);
      expect(sections(await list(s, next, north)).map((x) => x.name)).toEqual(['N']);
      expect(sections(await list(s, next))).toEqual([]);

      const empty = await h
        .post(`${BASE}/copy-from-previous`, s.admin.cookie)
        .send({ yearId: next, campusId: south });
      expect(empty.status).toBe(409);
      expect(problem(empty).type).toBe('nothing-to-copy');
    });

    it('drops a teacher who already leads a section in the target year', async () => {
      const { s, year } = await setup();
      await create(s, year, { classTeacherMembershipId: s.teacher.membershipId });
      const north = await h.campus(s.tenantId, 'North');
      const next = await h.year(s.tenantId, 2027, 'PLANNED');
      await create(s, next, { campusId: north, classTeacherMembershipId: s.teacher.membershipId });
      const res = await h
        .post(`${BASE}/copy-from-previous`, s.admin.cookie)
        .send({ yearId: next, campusId: s.primaryCampusId });
      expect(res.status).toBe(201);
      expect(copySectionsResponseSchema.parse(res.body).dropped).toEqual([
        { section: 'VI-A', field: 'teacher' },
      ]);
    });

    it('skips sections whose class is outside a narrowed range and reports them', async () => {
      const { s, year } = await setup();
      await create(s, year, { classLevel: 'X', name: 'A' });
      await create(s, year, { classLevel: 'XII', name: 'A' });
      await create(s, year, { classLevel: 'XII', name: 'B' });
      const next = await h.year(s.tenantId, 2027, 'PLANNED');
      await h.owner.schoolProfile.update({
        where: { tenantId: s.tenantId },
        data: { highestClass: 'X' },
      });
      const res = await h
        .post(`${BASE}/copy-from-previous`, s.admin.cookie)
        .send({ yearId: next, campusId: s.primaryCampusId });
      expect(res.status).toBe(201);
      expect(copySectionsResponseSchema.parse(res.body)).toEqual({
        created: 1,
        dropped: [
          { section: 'XII-A', field: 'class' },
          { section: 'XII-B', field: 'class' },
        ],
      });
      expect(sections(await list(s, next)).map((x) => `${x.classLevel}-${x.name}`)).toEqual([
        'X-A',
      ]);
    });

    it('answers 201 with created 0 when every source section is outside the range', async () => {
      const { s, year } = await setup();
      await create(s, year, { classLevel: 'XII', name: 'A' });
      const next = await h.year(s.tenantId, 2027, 'PLANNED');
      await h.owner.schoolProfile.update({
        where: { tenantId: s.tenantId },
        data: { highestClass: 'X' },
      });
      const res = await h
        .post(`${BASE}/copy-from-previous`, s.admin.cookie)
        .send({ yearId: next, campusId: s.primaryCampusId });
      expect(res.status).toBe(201);
      expect(copySectionsResponseSchema.parse(res.body)).toEqual({
        created: 0,
        dropped: [{ section: 'XII-A', field: 'class' }],
      });
      const copied = (await h.audits(s.tenantId, 'academic_year')).filter(
        (e) => e.action === 'sections.copied',
      );
      expect(copied).toHaveLength(1);
    });

    it('gives 409 nothing-to-copy when copying into the first year', async () => {
      const { s, year } = await setup();
      const res = await h
        .post(`${BASE}/copy-from-previous`, s.admin.cookie)
        .send({ yearId: year, campusId: s.primaryCampusId });
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('nothing-to-copy');
    });
  });

  describe('class-teacher options', () => {
    it('lists active members with the section they lead that year', async () => {
      const { s, year } = await setup();
      const gone = await s.person('TEACHER');
      await deactivate(gone.membershipId);
      await create(s, year, { name: 'B', classTeacherMembershipId: s.teacher.membershipId });
      const res = await h.get(`/academics/class-teacher-options?yearId=${year}`, s.admin.cookie);
      expect(res.status).toBe(200);
      const teachers = classTeacherOptionsResponseSchema.parse(res.body).teachers;
      const ids = teachers.map((t) => t.membershipId);
      expect(ids).toContain(s.admin.membershipId);
      expect(ids).toContain(s.accountant.membershipId);
      expect(ids).not.toContain(gone.membershipId);
      expect(teachers.find((t) => t.membershipId === s.teacher.membershipId)?.sectionName).toBe(
        'VI-B',
      );
      expect(teachers.find((t) => t.membershipId === s.admin.membershipId)?.sectionName).toBeNull();
    });
  });

  describe('permissions and isolation', () => {
    it('lets a Teacher read sections, but not write or list class-teacher options', async () => {
      const { s, year } = await setup();
      const a = await create(s, year);
      const next = await h.year(s.tenantId, 2027, 'PLANNED');
      expect(
        (await h.get(`${BASE}?yearId=${year}&campusId=${s.primaryCampusId}`, s.teacher.cookie))
          .status,
      ).toBe(200);
      const writes = [
        h.post(BASE, s.teacher.cookie).send(body(s, year, { name: 'B' })),
        h.patch(`${BASE}/${a.id}`, s.teacher.cookie).send({ capacity: 30 }),
        h.del(`${BASE}/${a.id}`, s.teacher.cookie),
        h
          .post(`${BASE}/copy-from-previous`, s.teacher.cookie)
          .send({ yearId: next, campusId: s.primaryCampusId }),
        h.get(`/academics/class-teacher-options?yearId=${year}`, s.teacher.cookie),
      ];
      for (const res of await Promise.all(writes)) {
        expect(res.status).toBe(403);
        expect(problem(res).type).toBe('permission-denied');
      }
      expect((await list(s, year)).status).toBe(200);
      expect(
        (await h.get(`${BASE}?yearId=${year}&campusId=${s.primaryCampusId}`, s.accountant.cookie))
          .status,
      ).toBe(403);
    });

    it("gives 404 for another school's ids", async () => {
      const { s: a, year } = await setup();
      const { s: b } = await setup();
      const sec = await create(a, year);
      const calls = [
        h.patch(`${BASE}/${sec.id}`, b.admin.cookie).send({ capacity: 30 }),
        h.del(`${BASE}/${sec.id}`, b.admin.cookie),
        h.del(`${BASE}/not-a-uuid`, b.admin.cookie),
        h.get(`${BASE}?yearId=${year}&campusId=${a.primaryCampusId}`, b.admin.cookie),
        h.get(`/academics/class-teacher-options?yearId=${year}`, b.admin.cookie),
        h
          .post(`${BASE}/copy-from-previous`, b.admin.cookie)
          .send({ yearId: year, campusId: a.primaryCampusId }),
      ];
      for (const res of await Promise.all(calls)) expect(res.status).toBe(404);
      expect(await h.owner.section.findUniqueOrThrow({ where: { id: sec.id } })).toMatchObject({
        capacity: 40,
      });
    });
  });
});
