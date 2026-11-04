import { streamSchema, streamsResponseSchema } from '@classloom/contracts';
import type request from 'supertest';

import { academicsHarness, problem } from './helpers';

const BASE = '/academics/streams';
const stream = (res: request.Response) => streamSchema.parse(res.body);
const streams = (res: request.Response) => streamsResponseSchema.parse(res.body).streams;

describe('streams API', () => {
  const h = academicsHarness('STR');

  beforeAll(() => h.start());
  afterAll(() => h.stop());

  const create = async (cookie: string, name: string) => {
    const res = await h.post(BASE, cookie).send({ name });
    expect(res.status).toBe(201);
    return stream(res);
  };

  it('creates a stream with one stream.created row and lists active first, then by name', async () => {
    const s = await h.school();
    const sci = await create(s.admin.cookie, '  Science ');
    expect(sci).toMatchObject({ name: 'Science', status: 'ACTIVE' });
    const arts = await create(s.admin.cookie, 'Arts');
    await create(s.admin.cookie, 'Commerce');
    expect((await h.post(`${BASE}/${arts.id}/archive`, s.admin.cookie)).status).toBe(200);

    const res = await h.get(BASE, s.teacher.cookie);
    expect(res.status).toBe(200);
    expect(streams(res).map((x) => [x.name, x.status])).toEqual([
      ['Commerce', 'ACTIVE'],
      ['Science', 'ACTIVE'],
      ['Arts', 'ARCHIVED'],
    ]);
    const created = (await h.audits(s.tenantId, 'stream')).filter(
      (e) => e.action === 'stream.created',
    );
    expect(created).toHaveLength(3);
    expect(created[0]).toMatchObject({ targetId: sci.id, actorUserId: s.admin.userId });
    expect(created[0]!.after).toEqual({ name: 'Science' });
  });

  it('addStarterStreams creates 3; a second call creates 0 and returns them as skipped', async () => {
    const s = await h.school();
    const first = await h.post(`${BASE}/starter`, s.admin.cookie);
    expect(first.status).toBe(201);
    const body1 = first.body as { created: { name: string }[]; skipped: string[] };
    expect(body1.created.map((x) => x.name)).toEqual(['Science', 'Commerce', 'Humanities']);
    expect(body1.skipped).toEqual([]);

    const second = await h.post(`${BASE}/starter`, s.admin.cookie);
    expect(second.status).toBe(201);
    const body2 = second.body as { created: unknown[]; skipped: string[] };
    expect(body2.created).toEqual([]);
    expect(body2.skipped).toEqual(['Science', 'Commerce', 'Humanities']);
    expect(await h.owner.stream.count({ where: { tenantId: s.tenantId } })).toBe(3);
  });

  it('skips a starter stream whose name exists in another case', async () => {
    const s = await h.school();
    await create(s.admin.cookie, 'SCIENCE');
    const res = await h.post(`${BASE}/starter`, s.admin.cookie);
    const body = res.body as { created: { name: string }[]; skipped: string[] };
    expect(body.created.map((x) => x.name)).toEqual(['Commerce', 'Humanities']);
    expect(body.skipped).toEqual(['Science']);
  });

  it('gives 409 name-taken with field name for a duplicate, ignoring case', async () => {
    const s = await h.school();
    await create(s.admin.cookie, 'Science');
    const dup = await h.post(BASE, s.admin.cookie).send({ name: 'science' });
    expect(dup.status).toBe(409);
    expect(problem(dup)).toMatchObject({ type: 'name-taken', field: 'name' });

    const other = await create(s.admin.cookie, 'Commerce');
    const res = await h.patch(`${BASE}/${other.id}`, s.admin.cookie).send({ name: 'SCIENCE' });
    expect(res.status).toBe(409);
    expect(problem(res)).toMatchObject({ type: 'name-taken', field: 'name' });
  });

  it('renames with one stream.updated row holding only the changed field', async () => {
    const s = await h.school();
    const st = await create(s.admin.cookie, 'Science');
    const res = await h.patch(`${BASE}/${st.id}`, s.admin.cookie).send({ name: 'Sciences' });
    expect(res.status).toBe(200);
    expect(stream(res).name).toBe('Sciences');
    const same = await h.patch(`${BASE}/${st.id}`, s.admin.cookie).send({ name: 'Sciences' });
    expect(same.status).toBe(200);
    const updates = (await h.audits(s.tenantId, 'stream')).filter(
      (e) => e.action === 'stream.updated',
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]!.before).toEqual({ name: 'Science' });
    expect(updates[0]!.after).toEqual({ name: 'Sciences' });
  });

  it('archive and restore each write one audit row; repeating is a no-op', async () => {
    const s = await h.school();
    const st = await create(s.admin.cookie, 'Science');
    const a = await h.post(`${BASE}/${st.id}/archive`, s.admin.cookie);
    expect(a.status).toBe(200);
    expect(stream(a).status).toBe('ARCHIVED');
    await h.post(`${BASE}/${st.id}/archive`, s.admin.cookie);
    const r = await h.post(`${BASE}/${st.id}/restore`, s.admin.cookie);
    expect(r.status).toBe(200);
    expect(stream(r).status).toBe('ACTIVE');
    const events = (await h.audits(s.tenantId, 'stream')).map((e) => e.action);
    expect(events).toEqual(['stream.created', 'stream.archived', 'stream.restored']);
  });

  it('deletes an unused stream with one stream.deleted row and 204', async () => {
    const s = await h.school();
    const st = await create(s.admin.cookie, 'Science');
    const res = await h.del(`${BASE}/${st.id}`, s.admin.cookie);
    expect(res.status).toBe(204);
    expect(await h.owner.stream.count({ where: { tenantId: s.tenantId } })).toBe(0);
    const events = await h.audits(s.tenantId, 'stream');
    expect(events.map((e) => e.action)).toEqual(['stream.created', 'stream.deleted']);
    expect(events[1]!.before).toMatchObject({ name: 'Science' });
  });

  it('gives 409 in-use with counts when a class subject uses the stream', async () => {
    const s = await h.school();
    const st = await create(s.admin.cookie, 'Science');
    const subject = await h.owner.subject.create({
      data: { tenantId: s.tenantId, name: 'Physics', type: 'SCHOLASTIC' },
    });
    await h.owner.classSubject.create({
      data: {
        tenantId: s.tenantId,
        classLevel: 'XI',
        streamId: st.id,
        subjectId: subject.id,
        kind: 'COMPULSORY',
      },
    });
    const res = await h.del(`${BASE}/${st.id}`, s.admin.cookie);
    expect(res.status).toBe(409);
    expect(problem(res)).toMatchObject({
      type: 'in-use',
      counts: { sections: 0, classSubjects: 1 },
    });
    expect(await h.owner.stream.count({ where: { tenantId: s.tenantId } })).toBe(1);
  });

  it('gives 409 academics-limit with the limit from the 21st stream', async () => {
    const s = await h.school();
    await h.owner.stream.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({ tenantId: s.tenantId, name: `Stream ${i}` })),
    });
    const res = await h.post(BASE, s.admin.cookie).send({ name: 'One more' });
    expect(res.status).toBe(409);
    expect(problem(res)).toMatchObject({ type: 'academics-limit', limit: 20 });
    const starter = await h.post(`${BASE}/starter`, s.admin.cookie);
    expect(starter.status).toBe(409);
    expect(problem(starter).type).toBe('academics-limit');
  });

  it('refuses a status in PATCH with 400: archive and restore are the only status changes', async () => {
    const s = await h.school();
    const st = await create(s.admin.cookie, 'Science');
    const res = await h.patch(`${BASE}/${st.id}`, s.admin.cookie).send({ status: 'ARCHIVED' });
    expect(res.status).toBe(400);
    expect((await h.owner.stream.findUniqueOrThrow({ where: { id: st.id } })).status).toBe(
      'ACTIVE',
    );
    expect((await h.audits(s.tenantId, 'stream')).map((e) => e.action)).toEqual(['stream.created']);
  });

  it('refuses an invalid name with 400', async () => {
    const s = await h.school();
    expect((await h.post(BASE, s.admin.cookie).send({ name: 'S' })).status).toBe(400);
  });

  describe('permissions', () => {
    it('lets a Teacher read but not write', async () => {
      const s = await h.school();
      const st = await create(s.admin.cookie, 'Science');
      expect((await h.get(BASE, s.teacher.cookie)).status).toBe(200);
      const writes = [
        h.post(BASE, s.teacher.cookie).send({ name: 'Arts' }),
        h.post(`${BASE}/starter`, s.teacher.cookie),
        h.patch(`${BASE}/${st.id}`, s.teacher.cookie).send({ name: 'Arts' }),
        h.post(`${BASE}/${st.id}/archive`, s.teacher.cookie),
        h.post(`${BASE}/${st.id}/restore`, s.teacher.cookie),
        h.del(`${BASE}/${st.id}`, s.teacher.cookie),
      ];
      for (const res of await Promise.all(writes)) {
        expect(res.status).toBe(403);
        expect(problem(res).type).toBe('permission-denied');
      }
    });

    it('refuses a member without classes.view', async () => {
      const s = await h.school();
      expect((await h.get(BASE, s.accountant.cookie)).status).toBe(403);
    });
  });

  it("gives 404 for another school's stream", async () => {
    const a = await h.school();
    const b = await h.school();
    const st = await create(a.admin.cookie, 'Science');
    const calls = [
      h.patch(`${BASE}/${st.id}`, b.admin.cookie).send({ name: 'Arts' }),
      h.post(`${BASE}/${st.id}/archive`, b.admin.cookie),
      h.post(`${BASE}/${st.id}/restore`, b.admin.cookie),
      h.del(`${BASE}/${st.id}`, b.admin.cookie),
      h.del(`${BASE}/not-a-uuid`, b.admin.cookie),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(404);
    expect(streams(await h.get(BASE, b.admin.cookie))).toEqual([]);
    expect(await h.owner.stream.findUniqueOrThrow({ where: { id: st.id } })).toMatchObject({
      name: 'Science',
      status: 'ACTIVE',
    });
  });
});
