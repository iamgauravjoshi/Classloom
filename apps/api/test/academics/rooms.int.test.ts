import { roomSchema, roomsResponseSchema } from '@classloom/contracts';
import type request from 'supertest';

import { academicsHarness, problem } from './helpers';

const BASE = '/academics/rooms';
const room = (res: request.Response) => roomSchema.parse(res.body);
const rooms = (res: request.Response) => roomsResponseSchema.parse(res.body).rooms;

describe('rooms API', () => {
  const h = academicsHarness('ROM');

  beforeAll(() => h.start());
  afterAll(() => h.stop());

  const create = async (cookie: string, campusId: string, name: string, extra = {}) => {
    const res = await h
      .post(BASE, cookie)
      .send({ campusId, name, type: 'CLASSROOM', capacity: 40, ...extra });
    expect(res.status).toBe(201);
    return room(res);
  };

  it('creates a room with one room.created row', async () => {
    const s = await h.school();
    const r = await create(s.admin.cookie, s.primaryCampusId, ' 101 ', { floor: 'Ground' });
    expect(r).toMatchObject({
      campusId: s.primaryCampusId,
      name: '101',
      type: 'CLASSROOM',
      capacity: 40,
      floor: 'Ground',
      status: 'ACTIVE',
    });
    const events = await h.audits(s.tenantId, 'room');
    expect(events.map((e) => e.action)).toEqual(['room.created']);
    expect(events[0]).toMatchObject({ targetId: r.id, actorUserId: s.admin.userId });
    expect(events[0]!.after).toMatchObject({ name: '101', campusId: s.primaryCampusId });
  });

  it('refuses a duplicate on the same campus differing only in case, but allows another campus', async () => {
    const s = await h.school();
    const north = await h.campus(s.tenantId, 'North');
    await create(s.admin.cookie, s.primaryCampusId, 'Lab A');
    const dup = await h
      .post(BASE, s.admin.cookie)
      .send({ campusId: s.primaryCampusId, name: 'LAB a', type: 'LAB', capacity: 30 });
    expect(dup.status).toBe(409);
    expect(problem(dup)).toMatchObject({ type: 'name-taken', field: 'name' });
    await create(s.admin.cookie, north, 'Lab A');

    const res = await h.get(`${BASE}?campusId=${north}`, s.teacher.cookie);
    expect(res.status).toBe(200);
    expect(rooms(res).map((r) => [r.name, r.campusId])).toEqual([['Lab A', north]]);
    expect(rooms(await h.get(BASE, s.teacher.cookie))).toHaveLength(2);
  });

  it('filters by status and lists active first, then by name', async () => {
    const s = await h.school();
    const b = await create(s.admin.cookie, s.primaryCampusId, 'B');
    await create(s.admin.cookie, s.primaryCampusId, 'C');
    await create(s.admin.cookie, s.primaryCampusId, 'A');
    await h.post(`${BASE}/${b.id}/archive`, s.admin.cookie);
    const all = rooms(await h.get(BASE, s.admin.cookie));
    expect(all.map((r) => r.name)).toEqual(['A', 'C', 'B']);
    const active = rooms(await h.get(`${BASE}?status=ACTIVE`, s.admin.cookie));
    expect(active.map((r) => r.name)).toEqual(['A', 'C']);
    const archived = rooms(await h.get(`${BASE}?status=ARCHIVED`, s.admin.cookie));
    expect(archived.map((r) => r.name)).toEqual(['B']);
  });

  it("gives 404 when creating on a campus that is not this school's", async () => {
    const a = await h.school();
    const b = await h.school();
    const res = await h
      .post(BASE, b.admin.cookie)
      .send({ campusId: a.primaryCampusId, name: '101', type: 'CLASSROOM', capacity: 40 });
    expect(res.status).toBe(404);
  });

  it('updates with one room.updated row holding only the changed fields', async () => {
    const s = await h.school();
    const r = await create(s.admin.cookie, s.primaryCampusId, '101');
    const res = await h
      .patch(`${BASE}/${r.id}`, s.admin.cookie)
      .send({ name: '101', capacity: 45, floor: '2' });
    expect(res.status).toBe(200);
    expect(room(res)).toMatchObject({ capacity: 45, floor: '2' });
    const updates = (await h.audits(s.tenantId, 'room')).filter((e) => e.action === 'room.updated');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.before).toEqual({ capacity: 40, floor: null });
    expect(updates[0]!.after).toEqual({ capacity: 45, floor: '2' });
  });

  it('archives and restores, one audit row each', async () => {
    const s = await h.school();
    const r = await create(s.admin.cookie, s.primaryCampusId, '101');
    expect(room(await h.post(`${BASE}/${r.id}/archive`, s.admin.cookie)).status).toBe('ARCHIVED');
    expect(room(await h.post(`${BASE}/${r.id}/restore`, s.admin.cookie)).status).toBe('ACTIVE');
    const events = (await h.audits(s.tenantId, 'room')).map((e) => e.action);
    expect(events).toEqual(['room.created', 'room.archived', 'room.restored']);
  });

  it('deletes an unused room; a room a section uses gives 409 in-use', async () => {
    const s = await h.school();
    const year = await h.year(s.tenantId, 2026, 'CURRENT');
    const used = await create(s.admin.cookie, s.primaryCampusId, '101');
    const free = await create(s.admin.cookie, s.primaryCampusId, '102');
    await h.owner.section.create({
      data: {
        tenantId: s.tenantId,
        academicYearId: year,
        campusId: s.primaryCampusId,
        classLevel: 'VI',
        name: 'A',
        capacity: 40,
        roomId: used.id,
      },
    });
    const res = await h.del(`${BASE}/${used.id}`, s.admin.cookie);
    expect(res.status).toBe(409);
    expect(problem(res)).toMatchObject({ type: 'in-use', counts: { sections: 1 } });
    expect((await h.del(`${BASE}/${free.id}`, s.admin.cookie)).status).toBe(204);
    const events = (await h.audits(s.tenantId, 'room')).map((e) => e.action);
    expect(events).toEqual(['room.created', 'room.created', 'room.deleted']);
  });

  it('keeps an archived room on its sections but refuses it for a new one', async () => {
    const s = await h.school();
    const year = await h.year(s.tenantId, 2026, 'CURRENT');
    const r = await create(s.admin.cookie, s.primaryCampusId, '101');
    const section = await h.post('/academics/sections', s.admin.cookie).send({
      academicYearId: year,
      campusId: s.primaryCampusId,
      classLevel: 'VI',
      name: 'A',
      capacity: 40,
      roomId: r.id,
    });
    expect(section.status).toBe(201);
    await h.post(`${BASE}/${r.id}/archive`, s.admin.cookie);

    const fresh = await h.post('/academics/sections', s.admin.cookie).send({
      academicYearId: year,
      campusId: s.primaryCampusId,
      classLevel: 'VI',
      name: 'B',
      capacity: 40,
      roomId: r.id,
    });
    expect(fresh.status).toBe(422);
    expect(problem(fresh).type).toBe('room-archived');

    const id = (section.body as { id: string }).id;
    const edit = await h.patch(`/academics/sections/${id}`, s.admin.cookie).send({ capacity: 35 });
    expect(edit.status).toBe(200);
    expect((edit.body as { room: { id: string } }).room.id).toBe(r.id);
  });

  it('gives 409 academics-limit from the 501st room', async () => {
    const s = await h.school();
    await h.owner.room.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        tenantId: s.tenantId,
        campusId: s.primaryCampusId,
        name: `R${i}`,
        type: 'CLASSROOM' as const,
        capacity: 40,
      })),
    });
    const res = await h
      .post(BASE, s.admin.cookie)
      .send({ campusId: s.primaryCampusId, name: 'One more', type: 'HALL', capacity: 100 });
    expect(res.status).toBe(409);
    expect(problem(res)).toMatchObject({ type: 'academics-limit', limit: 500 });
  });

  it('refuses invalid fields with 400', async () => {
    const s = await h.school();
    const bad = [
      { campusId: s.primaryCampusId, name: '', type: 'LAB', capacity: 10 },
      { campusId: s.primaryCampusId, name: 'X', type: 'GYM', capacity: 10 },
      { campusId: s.primaryCampusId, name: 'X', type: 'LAB', capacity: 501 },
      { campusId: s.primaryCampusId, name: 'X', type: 'LAB', capacity: 10, floor: 'x'.repeat(21) },
    ];
    for (const body of bad)
      expect((await h.post(BASE, s.admin.cookie).send(body)).status).toBe(400);
    const r = await create(s.admin.cookie, s.primaryCampusId, '101');
    for (const patch of [{ status: 'ARCHIVED' }, { campusId: s.primaryCampusId }]) {
      expect((await h.patch(`${BASE}/${r.id}`, s.admin.cookie).send(patch)).status).toBe(400);
    }
  });

  it('lets a Teacher read but not write', async () => {
    const s = await h.school();
    const r = await create(s.admin.cookie, s.primaryCampusId, '101');
    expect((await h.get(BASE, s.teacher.cookie)).status).toBe(200);
    const writes = [
      h
        .post(BASE, s.teacher.cookie)
        .send({ campusId: s.primaryCampusId, name: '102', type: 'LAB', capacity: 10 }),
      h.patch(`${BASE}/${r.id}`, s.teacher.cookie).send({ name: '103' }),
      h.post(`${BASE}/${r.id}/archive`, s.teacher.cookie),
      h.post(`${BASE}/${r.id}/restore`, s.teacher.cookie),
      h.del(`${BASE}/${r.id}`, s.teacher.cookie),
    ];
    for (const res of await Promise.all(writes)) {
      expect(res.status).toBe(403);
      expect(problem(res).type).toBe('permission-denied');
    }
    expect((await h.get(BASE, s.accountant.cookie)).status).toBe(403);
  });

  it("gives 404 for another school's room", async () => {
    const a = await h.school();
    const b = await h.school();
    const r = await create(a.admin.cookie, a.primaryCampusId, '101');
    const calls = [
      h.patch(`${BASE}/${r.id}`, b.admin.cookie).send({ name: '102' }),
      h.post(`${BASE}/${r.id}/archive`, b.admin.cookie),
      h.post(`${BASE}/${r.id}/restore`, b.admin.cookie),
      h.del(`${BASE}/${r.id}`, b.admin.cookie),
      h.del(`${BASE}/not-a-uuid`, b.admin.cookie),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(404);
    expect(rooms(await h.get(BASE, b.admin.cookie))).toEqual([]);
    expect(await h.owner.room.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({
      name: '101',
      status: 'ACTIVE',
    });
  });
});
