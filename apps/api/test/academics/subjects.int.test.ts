import {
  STARTER_SUBJECTS,
  starterSubjectsAddedResponseSchema,
  starterSubjectsResponseSchema,
  subjectSchema,
  subjectsResponseSchema,
} from '@classloom/contracts';
import type request from 'supertest';

import { academicsHarness, problem } from './helpers';

const BASE = '/academics/subjects';
const subject = (res: request.Response) => subjectSchema.parse(res.body);
const subjects = (res: request.Response) => subjectsResponseSchema.parse(res.body).subjects;

describe('subjects API', () => {
  const h = academicsHarness('SUB');

  beforeAll(() => h.start());
  afterAll(() => h.stop());

  const create = async (cookie: string, body: object) => {
    const res = await h.post(BASE, cookie).send(body);
    expect(res.status).toBe(201);
    return subject(res);
  };

  it('creates a subject with one subject.created row', async () => {
    const s = await h.school();
    const sub = await create(s.admin.cookie, {
      name: ' Physics ',
      code: '042',
      type: 'SCHOLASTIC',
    });
    expect(sub).toMatchObject({
      name: 'Physics',
      code: '042',
      type: 'SCHOLASTIC',
      status: 'ACTIVE',
    });
    const art = await create(s.admin.cookie, { name: 'Art Education', type: 'CO_SCHOLASTIC' });
    expect(art.code).toBeNull();
    const events = await h.audits(s.tenantId, 'subject');
    expect(events.map((e) => [e.action, e.targetId])).toEqual([
      ['subject.created', sub.id],
      ['subject.created', art.id],
    ]);
    expect(events[0]!.after).toEqual({ name: 'Physics', code: '042', type: 'SCHOLASTIC' });
  });

  it('lists active subjects first, then by name', async () => {
    const s = await h.school();
    await create(s.admin.cookie, { name: 'Physics', type: 'SCHOLASTIC' });
    const bio = await create(s.admin.cookie, { name: 'Biology', type: 'SCHOLASTIC' });
    await create(s.admin.cookie, { name: 'Chemistry', type: 'SCHOLASTIC' });
    await h.post(`${BASE}/${bio.id}/archive`, s.admin.cookie);
    const res = await h.get(BASE, s.teacher.cookie);
    expect(res.status).toBe(200);
    expect(subjects(res).map((x) => x.name)).toEqual(['Chemistry', 'Physics', 'Biology']);
  });

  it('allows two subjects with code 041', async () => {
    const s = await h.school();
    await create(s.admin.cookie, {
      name: 'Mathematics (Standard)',
      code: '041',
      type: 'SCHOLASTIC',
    });
    await create(s.admin.cookie, { name: 'Mathematics', code: '041', type: 'SCHOLASTIC' });
    expect(await h.owner.subject.count({ where: { tenantId: s.tenantId, code: '041' } })).toBe(2);
  });

  it('gives 409 name-taken with field name, ignoring case', async () => {
    const s = await h.school();
    await create(s.admin.cookie, { name: 'Physics', type: 'SCHOLASTIC' });
    const res = await h.post(BASE, s.admin.cookie).send({ name: 'PHYSICS', type: 'SCHOLASTIC' });
    expect(res.status).toBe(409);
    expect(problem(res)).toMatchObject({ type: 'name-taken', field: 'name' });
  });

  it('updates only the changed fields, and "" clears the code', async () => {
    const s = await h.school();
    const sub = await create(s.admin.cookie, { name: 'Physics', code: '042', type: 'SCHOLASTIC' });
    const res = await h
      .patch(`${BASE}/${sub.id}`, s.admin.cookie)
      .send({ code: '', name: 'Physics' });
    expect(res.status).toBe(200);
    expect(subject(res)).toMatchObject({ name: 'Physics', code: null });
    const [, updated] = await h.audits(s.tenantId, 'subject');
    expect(updated).toMatchObject({ action: 'subject.updated' });
    expect(updated!.before).toEqual({ code: '042' });
    expect(updated!.after).toEqual({ code: null });
  });

  it('gives 409 academics-limit from the 201st subject', async () => {
    const s = await h.school();
    await h.owner.subject.createMany({
      data: Array.from({ length: 200 }, (_, i) => ({
        tenantId: s.tenantId,
        name: `Subject ${i}`,
        type: 'SCHOLASTIC' as const,
      })),
    });
    const res = await h.post(BASE, s.admin.cookie).send({ name: 'One more', type: 'SCHOLASTIC' });
    expect(res.status).toBe(409);
    expect(problem(res)).toMatchObject({ type: 'academics-limit', limit: 200 });
    const starter = await h
      .post(`${BASE}/starter`, s.admin.cookie)
      .send({ items: [{ name: 'Another one', type: 'SCHOLASTIC' }] });
    expect(starter.status).toBe(409);
    expect(problem(starter).type).toBe('academics-limit');
  });

  describe('starter list', () => {
    it("returns the board's list with exists for names the school has", async () => {
      const s = await h.school();
      await create(s.admin.cookie, { name: 'physics', type: 'SCHOLASTIC' });
      const res = await h.get(`${BASE}/starter`, s.teacher.cookie);
      expect(res.status).toBe(200);
      const body = starterSubjectsResponseSchema.parse(res.body);
      expect(body.board).toBe('CBSE');
      expect(body.items.map((i) => i.name)).toEqual(STARTER_SUBJECTS.CBSE.map((i) => i.name));
      expect(body.items.filter((i) => i.exists).map((i) => i.name)).toEqual(['Physics']);
      expect(body.items.find((i) => i.name === 'Science')).toEqual({
        name: 'Science',
        code: '086',
        type: 'SCHOLASTIC',
        exists: false,
      });
      expect(body.items.find((i) => i.name === 'Art Education')?.code).toBeNull();
    });

    it('adds 5 items with one existing: created 4, skipped 1, one subjects.starter_added row', async () => {
      const s = await h.school();
      await create(s.admin.cookie, { name: 'Physics', type: 'SCHOLASTIC' });
      const res = await h.post(`${BASE}/starter`, s.admin.cookie).send({
        items: [
          { name: 'Science', code: '086', type: 'SCHOLASTIC' },
          { name: 'PHYSICS', code: '042', type: 'SCHOLASTIC' },
          { name: 'Chemistry', code: '043', type: 'SCHOLASTIC' },
          { name: 'Art Education', type: 'CO_SCHOLASTIC' },
          { name: 'Mathematics', code: '041', type: 'SCHOLASTIC' },
        ],
      });
      expect(res.status).toBe(201);
      const body = starterSubjectsAddedResponseSchema.parse(res.body);
      expect(body.created).toHaveLength(4);
      expect(body.created.map((c) => [c.name, c.code])).toEqual([
        ['Science', '086'],
        ['Chemistry', '043'],
        ['Art Education', null],
        ['Mathematics', '041'],
      ]);
      expect(body.skipped).toEqual(['PHYSICS']);
      expect(await h.owner.subject.count({ where: { tenantId: s.tenantId } })).toBe(5);
      const starter = (await h.audits(s.tenantId)).filter(
        (e) => e.action === 'subjects.starter_added',
      );
      expect(starter).toHaveLength(1);
      expect(starter[0]!.after).toMatchObject({
        names: ['Science', 'Chemistry', 'Art Education', 'Mathematics'],
      });
    });

    it('skips a name repeated within the request', async () => {
      const s = await h.school();
      const res = await h.post(`${BASE}/starter`, s.admin.cookie).send({
        items: [
          { name: 'Science', type: 'SCHOLASTIC' },
          { name: 'science', type: 'SCHOLASTIC' },
        ],
      });
      const body = starterSubjectsAddedResponseSchema.parse(res.body);
      expect(body.created.map((c) => c.name)).toEqual(['Science']);
      expect(body.skipped).toEqual(['science']);
    });

    it('writes no audit row when everything is skipped', async () => {
      const s = await h.school();
      await create(s.admin.cookie, { name: 'Science', type: 'SCHOLASTIC' });
      const res = await h
        .post(`${BASE}/starter`, s.admin.cookie)
        .send({ items: [{ name: 'Science', type: 'SCHOLASTIC' }] });
      expect(res.status).toBe(201);
      expect(starterSubjectsAddedResponseSchema.parse(res.body)).toEqual({
        created: [],
        skipped: ['Science'],
      });
      const actions = (await h.audits(s.tenantId)).map((e) => e.action);
      expect(actions).not.toContain('subjects.starter_added');
    });
  });

  it('archive and restore each write one audit row', async () => {
    const s = await h.school();
    const sub = await create(s.admin.cookie, { name: 'Physics', type: 'SCHOLASTIC' });
    expect(subject(await h.post(`${BASE}/${sub.id}/archive`, s.admin.cookie)).status).toBe(
      'ARCHIVED',
    );
    expect(subject(await h.post(`${BASE}/${sub.id}/restore`, s.admin.cookie)).status).toBe(
      'ACTIVE',
    );
    expect((await h.audits(s.tenantId, 'subject')).map((e) => e.action)).toEqual([
      'subject.created',
      'subject.archived',
      'subject.restored',
    ]);
  });

  it('deletes an unused subject, and refuses one a class uses with 409 in-use', async () => {
    const s = await h.school();
    const free = await create(s.admin.cookie, { name: 'Physics', type: 'SCHOLASTIC' });
    expect((await h.del(`${BASE}/${free.id}`, s.admin.cookie)).status).toBe(204);
    const used = await create(s.admin.cookie, { name: 'English', type: 'SCHOLASTIC' });
    await h.owner.classSubject.createMany({
      data: (['VI', 'VII'] as const).map((classLevel) => ({
        tenantId: s.tenantId,
        classLevel,
        subjectId: used.id,
        kind: 'COMPULSORY' as const,
      })),
    });
    const res = await h.del(`${BASE}/${used.id}`, s.admin.cookie);
    expect(res.status).toBe(409);
    expect(problem(res)).toMatchObject({ type: 'in-use', counts: { classSubjects: 2 } });
    const actions = (await h.audits(s.tenantId, 'subject')).map((e) => e.action);
    expect(actions).toEqual(['subject.created', 'subject.deleted', 'subject.created']);
  });

  describe('permissions', () => {
    it('lets a Teacher read but not write', async () => {
      const s = await h.school();
      const sub = await create(s.admin.cookie, { name: 'Physics', type: 'SCHOLASTIC' });
      expect((await h.get(BASE, s.teacher.cookie)).status).toBe(200);
      expect((await h.get(`${BASE}/starter`, s.teacher.cookie)).status).toBe(200);
      const writes = [
        h.post(BASE, s.teacher.cookie).send({ name: 'Arts', type: 'SCHOLASTIC' }),
        h
          .post(`${BASE}/starter`, s.teacher.cookie)
          .send({ items: [{ name: 'Arts', type: 'SCHOLASTIC' }] }),
        h.patch(`${BASE}/${sub.id}`, s.teacher.cookie).send({ name: 'Arts' }),
        h.post(`${BASE}/${sub.id}/archive`, s.teacher.cookie),
        h.post(`${BASE}/${sub.id}/restore`, s.teacher.cookie),
        h.del(`${BASE}/${sub.id}`, s.teacher.cookie),
      ];
      for (const res of await Promise.all(writes)) expect(res.status).toBe(403);
    });

    it('refuses listSubjects to a member without subjects.view', async () => {
      const s = await h.school();
      const res = await h.get(BASE, s.accountant.cookie);
      expect(res.status).toBe(403);
      expect(problem(res).type).toBe('permission-denied');
      expect((await h.get(`${BASE}/starter`, s.accountant.cookie)).status).toBe(403);
    });
  });

  it("gives 404 for another school's subject", async () => {
    const a = await h.school();
    const b = await h.school();
    const sub = await create(a.admin.cookie, { name: 'Physics', type: 'SCHOLASTIC' });
    const calls = [
      h.patch(`${BASE}/${sub.id}`, b.admin.cookie).send({ name: 'Arts' }),
      h.post(`${BASE}/${sub.id}/archive`, b.admin.cookie),
      h.post(`${BASE}/${sub.id}/restore`, b.admin.cookie),
      h.del(`${BASE}/${sub.id}`, b.admin.cookie),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(404);
    expect(subjects(await h.get(BASE, b.admin.cookie))).toEqual([]);
  });
});
