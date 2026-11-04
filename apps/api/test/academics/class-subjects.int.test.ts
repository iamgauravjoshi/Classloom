import { classSubjectsResponseSchema } from '@classloom/contracts';
import type request from 'supertest';

import { academicsHarness, type AcademicsSchool, problem } from './helpers';

const BASE = '/academics/class-subjects';
const classes = (res: request.Response) => classSubjectsResponseSchema.parse(res.body).classes;

describe('class subjects API', () => {
  const h = academicsHarness('CLS');

  beforeAll(() => h.start());
  afterAll(() => h.stop());

  /** A school with subjects English, Physics, Chemistry and History and streams Science, Commerce. */
  async function setup(range: Parameters<typeof h.school>[0] = ['I', 'XII']) {
    const s = await h.school(range);
    const sub = async (name: string) =>
      h.owner.subject.create({ data: { tenantId: s.tenantId, name, type: 'SCHOLASTIC' } });
    const str = async (name: string) =>
      h.owner.stream.create({ data: { tenantId: s.tenantId, name } });
    return {
      s,
      english: await sub('English'),
      physics: await sub('Physics'),
      chemistry: await sub('Chemistry'),
      history: await sub('History'),
      science: await str('Science'),
      commerce: await str('Commerce'),
    };
  }

  const put = (s: AcademicsSchool, level: string, rows: object[]) =>
    h.put(`${BASE}/${level}`, s.admin.cookie).send({ rows });
  const stored = (tenantId: string, classLevel: 'VI' | 'XI' | 'XII') =>
    h.owner.classSubject.findMany({
      where: { tenantId, classLevel },
      select: { subjectId: true, streamId: true, kind: true },
    });

  it('saves an "all streams" row and a Science row for XI', async () => {
    const { s, english, physics, science } = await setup();
    const res = await put(s, 'XI', [
      { subjectId: english.id, streamId: null, kind: 'COMPULSORY' },
      { subjectId: physics.id, streamId: science.id, kind: 'OPTIONAL' },
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ classLevel: 'XI', outsideRange: false });
    expect(await stored(s.tenantId, 'XI')).toEqual(
      expect.arrayContaining([
        { subjectId: english.id, streamId: null, kind: 'COMPULSORY' },
        { subjectId: physics.id, streamId: science.id, kind: 'OPTIONAL' },
      ]),
    );
    expect(await stored(s.tenantId, 'XI')).toHaveLength(2);

    const list = classes(await h.get(BASE, s.teacher.cookie));
    const xi = list.find((c) => c.classLevel === 'XI');
    expect(xi?.rows).toHaveLength(2);
    expect(xi?.outsideRange).toBe(false);
  });

  it('replaces the rows and writes one class_subjects.updated row with before and after', async () => {
    const { s, english, history } = await setup();
    await put(s, 'VI', [{ subjectId: english.id, streamId: null, kind: 'COMPULSORY' }]);
    const res = await put(s, 'VI', [{ subjectId: history.id, streamId: null, kind: 'OPTIONAL' }]);
    expect(res.status).toBe(200);
    expect(await stored(s.tenantId, 'VI')).toEqual([
      { subjectId: history.id, streamId: null, kind: 'OPTIONAL' },
    ]);
    const events = await h.audits(s.tenantId, 'class_level');
    expect(events.map((e) => e.action)).toEqual([
      'class_subjects.updated',
      'class_subjects.updated',
    ]);
    expect(events[1]!.before).toEqual({
      classLevel: 'VI',
      rows: [{ subjectId: english.id, streamId: null, kind: 'COMPULSORY' }],
    });
    expect(events[1]!.after).toEqual({
      classLevel: 'VI',
      rows: [{ subjectId: history.id, streamId: null, kind: 'OPTIONAL' }],
    });
    // The same rows again change nothing and write nothing.
    await put(s, 'VI', [{ subjectId: history.id, streamId: null, kind: 'OPTIONAL' }]);
    expect(await h.audits(s.tenantId, 'class_level')).toHaveLength(2);
  });

  it('gives 422 stream-not-allowed for a stream on VI', async () => {
    const { s, physics, science } = await setup();
    const res = await put(s, 'VI', [
      { subjectId: physics.id, streamId: science.id, kind: 'COMPULSORY' },
    ]);
    expect(res.status).toBe(422);
    expect(problem(res).type).toBe('stream-not-allowed');
    expect(await stored(s.tenantId, 'VI')).toEqual([]);
  });

  it('gives 422 for a repeated subject and stream', async () => {
    const { s, physics } = await setup();
    const row = { subjectId: physics.id, streamId: null, kind: 'COMPULSORY' };
    const res = await put(s, 'XI', [row, { ...row, kind: 'OPTIONAL' }]);
    expect(res.status).toBe(422);
    expect(problem(res).errors?.[0]?.path).toBe('rows.1');
  });

  it('gives 422 class-out-of-range outside the range, and 409 classes-not-set without one', async () => {
    const { s, english } = await setup(['I', 'X']);
    const row = { subjectId: english.id, streamId: null, kind: 'COMPULSORY' };
    const out = await put(s, 'XI', [row]);
    expect(out.status).toBe(422);
    expect(problem(out).type).toBe('class-out-of-range');

    const none = await setup(null);
    const res = await put(none.s, 'VI', [{ ...row, subjectId: none.english.id }]);
    expect(res.status).toBe(409);
    expect(problem(res).type).toBe('classes-not-set');
  });

  it('refuses an unknown class level with 400', async () => {
    const { s } = await setup();
    expect((await put(s, 'XIII', [])).status).toBe(400);
  });

  it('keeps an archived subject already in the class but refuses adding it (422 subject-archived)', async () => {
    const { s, english, history } = await setup();
    await put(s, 'VI', [{ subjectId: english.id, streamId: null, kind: 'COMPULSORY' }]);
    await h.owner.subject.updateMany({
      where: { id: { in: [english.id, history.id] } },
      data: { status: 'ARCHIVED' },
    });
    const keep = await put(s, 'VI', [{ subjectId: english.id, streamId: null, kind: 'OPTIONAL' }]);
    expect(keep.status).toBe(200);
    const add = await put(s, 'VI', [
      { subjectId: english.id, streamId: null, kind: 'OPTIONAL' },
      { subjectId: history.id, streamId: null, kind: 'OPTIONAL' },
    ]);
    expect(add.status).toBe(422);
    expect(problem(add).type).toBe('subject-archived');
    expect(problem(add).errors?.[0]?.path).toBe('rows.1.subjectId');
    // Nor in another class.
    const other = await put(s, 'VII', [
      { subjectId: english.id, streamId: null, kind: 'OPTIONAL' },
    ]);
    expect(other.status).toBe(422);
  });

  it('refuses an archived stream newly added', async () => {
    const { s, physics, science } = await setup();
    await h.owner.stream.update({ where: { id: science.id }, data: { status: 'ARCHIVED' } });
    const res = await put(s, 'XI', [
      { subjectId: physics.id, streamId: science.id, kind: 'COMPULSORY' },
    ]);
    expect(res.status).toBe(422);
    expect(problem(res).errors?.[0]?.path).toBe('rows.0.streamId');
  });

  it('gives 422 for a subject or stream of another school', async () => {
    const a = await setup();
    const b = await setup();
    const sub = await put(b.s, 'VI', [
      { subjectId: a.english.id, streamId: null, kind: 'COMPULSORY' },
    ]);
    expect(sub.status).toBe(422);
    expect(problem(sub).errors?.[0]?.path).toBe('rows.0.subjectId');
    const str = await put(b.s, 'XI', [
      { subjectId: b.english.id, streamId: a.science.id, kind: 'COMPULSORY' },
    ]);
    expect(str.status).toBe(422);
    expect(problem(str).errors?.[0]?.path).toBe('rows.0.streamId');
    expect(classes(await h.get(BASE, b.s.admin.cookie)).flatMap((c) => c.rows)).toEqual([]);
  });

  it('ends two concurrent PUTs with the rows of exactly one request', async () => {
    const { s, english, physics, chemistry, history, science, commerce } = await setup();
    const first = [
      { subjectId: english.id, streamId: null, kind: 'COMPULSORY' },
      { subjectId: physics.id, streamId: science.id, kind: 'COMPULSORY' },
      { subjectId: chemistry.id, streamId: science.id, kind: 'OPTIONAL' },
    ];
    const second = [
      { subjectId: english.id, streamId: null, kind: 'OPTIONAL' },
      { subjectId: history.id, streamId: commerce.id, kind: 'COMPULSORY' },
    ];
    for (let round = 0; round < 3; round += 1) {
      const [r1, r2] = await Promise.all([put(s, 'XI', first), put(s, 'XI', second)]);
      expect([r1.status, r2.status]).toEqual([200, 200]);
      const rows = await stored(s.tenantId, 'XI');
      const sort = (list: object[]) => list.map((r) => JSON.stringify(r)).sort();
      expect([sort(first), sort(second)]).toContainEqual(sort(rows));
    }
  });

  it('keeps rows outside a narrowed range readable but not editable', async () => {
    const { s, english } = await setup();
    const row = { subjectId: english.id, streamId: null, kind: 'COMPULSORY' };
    expect((await put(s, 'XI', [row])).status).toBe(200);
    await h.owner.schoolProfile.update({
      where: { tenantId: s.tenantId },
      data: { highestClass: 'X' },
    });
    const list = classes(await h.get(BASE, s.admin.cookie));
    const xi = list.find((c) => c.classLevel === 'XI');
    expect(xi).toEqual({ classLevel: 'XI', outsideRange: true, rows: [row] });
    expect(list.find((c) => c.classLevel === 'X')).toEqual({
      classLevel: 'X',
      outsideRange: false,
      rows: [],
    });
    expect(list.some((c) => c.classLevel === 'XII')).toBe(false);
    const res = await put(s, 'XI', []);
    expect(res.status).toBe(422);
    expect(problem(res).type).toBe('class-out-of-range');
  });

  it('lists in-range classes in order, with empty ones', async () => {
    const { s } = await setup(['IX', 'XII']);
    const list = classes(await h.get(BASE, s.admin.cookie));
    expect(list.map((c) => c.classLevel)).toEqual(['IX', 'X', 'XI', 'XII']);
  });

  describe('permissions', () => {
    it('lets a Teacher read but not write', async () => {
      const { s, english } = await setup();
      expect((await h.get(BASE, s.teacher.cookie)).status).toBe(200);
      const res = await h
        .put(`${BASE}/VI`, s.teacher.cookie)
        .send({ rows: [{ subjectId: english.id, streamId: null, kind: 'COMPULSORY' }] });
      expect(res.status).toBe(403);
    });

    it('refuses a member without subjects.view', async () => {
      const { s } = await setup();
      expect((await h.get(BASE, s.accountant.cookie)).status).toBe(403);
    });
  });
});
