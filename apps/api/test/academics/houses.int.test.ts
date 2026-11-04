import { houseSchema, housesResponseSchema } from '@classloom/contracts';
import type request from 'supertest';

import { academicsHarness, problem } from './helpers';

const BASE = '/academics/houses';
const house = (res: request.Response) => houseSchema.parse(res.body);
const houses = (res: request.Response) => housesResponseSchema.parse(res.body).houses;

describe('houses API', () => {
  const h = academicsHarness('HSE');

  beforeAll(() => h.start());
  afterAll(() => h.stop());

  const create = async (cookie: string, name: string, colour = 'RED') => {
    const res = await h.post(BASE, cookie).send({ name, colour });
    expect(res.status).toBe(201);
    return house(res);
  };

  it('creates houses with one house.created row each and lists active first, then by name', async () => {
    const s = await h.school();
    const tagore = await create(s.admin.cookie, ' Tagore ', 'BLUE');
    expect(tagore).toMatchObject({ name: 'Tagore', colour: 'BLUE', status: 'ACTIVE' });
    const ashoka = await create(s.admin.cookie, 'Ashoka', 'GREEN');
    await create(s.admin.cookie, 'Raman', 'YELLOW');
    expect((await h.post(`${BASE}/${ashoka.id}/archive`, s.admin.cookie)).status).toBe(200);

    const res = await h.get(BASE, s.teacher.cookie);
    expect(res.status).toBe(200);
    expect(houses(res).map((x) => [x.name, x.status])).toEqual([
      ['Raman', 'ACTIVE'],
      ['Tagore', 'ACTIVE'],
      ['Ashoka', 'ARCHIVED'],
    ]);
    const created = (await h.audits(s.tenantId, 'house')).filter(
      (e) => e.action === 'house.created',
    );
    expect(created).toHaveLength(3);
    expect(created[0]).toMatchObject({ targetId: tagore.id, actorUserId: s.admin.userId });
    expect(created[0]!.after).toEqual({ name: 'Tagore', colour: 'BLUE' });
  });

  it('gives 409 name-taken for a duplicate differing only in case', async () => {
    const s = await h.school();
    await create(s.admin.cookie, 'Tagore');
    const dup = await h.post(BASE, s.admin.cookie).send({ name: 'TAGORE', colour: 'RED' });
    expect(dup.status).toBe(409);
    expect(problem(dup)).toMatchObject({ type: 'name-taken', field: 'name' });
    const other = await create(s.admin.cookie, 'Raman');
    const res = await h.patch(`${BASE}/${other.id}`, s.admin.cookie).send({ name: 'tagore' });
    expect(res.status).toBe(409);
    expect(problem(res)).toMatchObject({ type: 'name-taken', field: 'name' });
  });

  it('updates with one house.updated row holding only the changed fields', async () => {
    const s = await h.school();
    const t = await create(s.admin.cookie, 'Tagore', 'RED');
    const res = await h
      .patch(`${BASE}/${t.id}`, s.admin.cookie)
      .send({ name: 'Tagore', colour: 'TEAL' });
    expect(res.status).toBe(200);
    expect(house(res).colour).toBe('TEAL');
    expect((await h.patch(`${BASE}/${t.id}`, s.admin.cookie).send({})).status).toBe(200);
    const updates = (await h.audits(s.tenantId, 'house')).filter(
      (e) => e.action === 'house.updated',
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]!.before).toEqual({ colour: 'RED' });
    expect(updates[0]!.after).toEqual({ colour: 'TEAL' });
  });

  it('archives, restores and deletes, one audit row each', async () => {
    const s = await h.school();
    const t = await create(s.admin.cookie, 'Tagore');
    const a = await h.post(`${BASE}/${t.id}/archive`, s.admin.cookie);
    expect(house(a).status).toBe('ARCHIVED');
    await h.post(`${BASE}/${t.id}/archive`, s.admin.cookie);
    const r = await h.post(`${BASE}/${t.id}/restore`, s.admin.cookie);
    expect(house(r).status).toBe('ACTIVE');
    expect((await h.del(`${BASE}/${t.id}`, s.admin.cookie)).status).toBe(204);
    expect(await h.owner.house.count({ where: { tenantId: s.tenantId } })).toBe(0);
    const events = await h.audits(s.tenantId, 'house');
    expect(events.map((e) => e.action)).toEqual([
      'house.created',
      'house.archived',
      'house.restored',
      'house.deleted',
    ]);
    expect(events[3]!.before).toMatchObject({ name: 'Tagore' });
  });

  it('gives 409 academics-limit from the 21st house', async () => {
    const s = await h.school();
    await h.owner.house.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        tenantId: s.tenantId,
        name: `House ${i}`,
        colour: 'RED' as const,
      })),
    });
    const res = await h.post(BASE, s.admin.cookie).send({ name: 'One more', colour: 'RED' });
    expect(res.status).toBe(409);
    expect(problem(res)).toMatchObject({ type: 'academics-limit', limit: 20 });
  });

  it('refuses an invalid name or colour with 400', async () => {
    const s = await h.school();
    expect((await h.post(BASE, s.admin.cookie).send({ name: 'T', colour: 'RED' })).status).toBe(
      400,
    );
    expect(
      (await h.post(BASE, s.admin.cookie).send({ name: 'Tagore', colour: 'BLACK' })).status,
    ).toBe(400);
    const t = await create(s.admin.cookie, 'Tagore');
    const status = await h.patch(`${BASE}/${t.id}`, s.admin.cookie).send({ status: 'ARCHIVED' });
    expect(status.status).toBe(400);
  });

  it('lets a Teacher read but not write', async () => {
    const s = await h.school();
    const t = await create(s.admin.cookie, 'Tagore');
    expect((await h.get(BASE, s.teacher.cookie)).status).toBe(200);
    const writes = [
      h.post(BASE, s.teacher.cookie).send({ name: 'Raman', colour: 'RED' }),
      h.patch(`${BASE}/${t.id}`, s.teacher.cookie).send({ name: 'Raman' }),
      h.post(`${BASE}/${t.id}/archive`, s.teacher.cookie),
      h.post(`${BASE}/${t.id}/restore`, s.teacher.cookie),
      h.del(`${BASE}/${t.id}`, s.teacher.cookie),
    ];
    for (const res of await Promise.all(writes)) {
      expect(res.status).toBe(403);
      expect(problem(res).type).toBe('permission-denied');
    }
    expect((await h.get(BASE, s.accountant.cookie)).status).toBe(403);
  });

  it("gives 404 for another school's house", async () => {
    const a = await h.school();
    const b = await h.school();
    const t = await create(a.admin.cookie, 'Tagore');
    const calls = [
      h.patch(`${BASE}/${t.id}`, b.admin.cookie).send({ name: 'Raman' }),
      h.post(`${BASE}/${t.id}/archive`, b.admin.cookie),
      h.post(`${BASE}/${t.id}/restore`, b.admin.cookie),
      h.del(`${BASE}/${t.id}`, b.admin.cookie),
      h.del(`${BASE}/not-a-uuid`, b.admin.cookie),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(404);
    expect(houses(await h.get(BASE, b.admin.cookie))).toEqual([]);
    expect(await h.owner.house.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({
      name: 'Tagore',
      status: 'ACTIVE',
    });
  });
});
