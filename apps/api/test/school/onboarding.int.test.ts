import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { onboardingResponseSchema, STARTER_SUBJECTS } from '@classloom/contracts';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import type { App } from 'supertest/types';

import { CliModule } from '../../src/cli/cli.module';
import { registerSchoolCommands } from '../../src/cli/school.commands';
import { buildCli } from '../../src/cli/schools.commands';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import { SessionService } from '../../src/modules/auth/session.service';
import { addMember, seedSchool } from '../auth/helpers';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';

const WEB_ORIGIN = 'http://localhost:3000';
const COOKIE = 'cl_session';
const BASE = '/school/onboarding';

const PROFILE = {
  name: 'Doon Valley Public School',
  board: 'CBSE',
  udiseCode: '05050101234',
  phone: '98765 43210',
  addressLine1: '12 Rajpur Road',
  city: 'Dehradun',
  state: 'UK',
  pinCode: '248001',
  lowestClass: 'I',
  highestClass: 'XII',
};

const checklist = (res: request.Response) => onboardingResponseSchema.parse(res.body);
const idOf = (res: request.Response) => (res.body as { id: string }).id;
const doneOf = (res: request.Response) =>
  Object.fromEntries(checklist(res).items.map((i) => [i.key, i.done]));

describe('onboarding checklist API', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let sessions: SessionService;
  let cli: INestApplicationContext;
  let counter = 0;
  let jpeg: Buffer;

  /** A school as registration leaves it (profile row, one primary campus), plus a Teacher. */
  async function school() {
    counter += 1;
    const code = `ONB${counter}`;
    const ids = await seedSchool(owner, { code, email: `o${counter}@onboarding.test` });
    await owner.schoolProfile.create({
      data: { tenantId: ids.tenantId, city: 'Dehradun', state: 'UK' },
    });
    const session = async (userId: string, membershipId: string) => {
      const { token } = await sessions.create({
        tenantId: ids.tenantId,
        userId,
        membershipId,
        remember: false,
      });
      return `${COOKIE}=${token}`;
    };
    counter += 1;
    const teacher = await owner.user.create({
      data: { email: `t${counter}@onboarding.test`, name: `Teacher ${counter}` },
    });
    const tm = await addMember(owner, ids.tenantId, teacher.id, 'TEACHER');
    const primary = await owner.campus.findFirstOrThrow({
      where: { tenantId: ids.tenantId, isPrimary: true },
    });
    return {
      code,
      tenantId: ids.tenantId,
      primaryId: primary.id,
      owner: await session(ids.userId, ids.membershipId),
      /** A fresh session for the owner, as signing in again gives. */
      signIn: () => session(ids.userId, ids.membershipId),
      teacher: await session(teacher.id, tm.id),
    };
  }

  const get = (cookie: string) => request(server).get(BASE).set('Cookie', cookie);
  const send = (method: 'post' | 'put' | 'patch', url: string, cookie: string) =>
    request(server)[method](url).set('Cookie', cookie).set('Origin', WEB_ORIGIN);

  beforeAll(async () => {
    infra = await startTestInfra({ storage: true });
    app = await createApp(infra.env, { logger: false });
    await app.init();
    server = app.getHttpServer() as App;
    owner = ownerPrisma(infra.env);
    sessions = app.get(SessionService);
    cli = await NestFactory.createApplicationContext(CliModule.forRoot(infra.env), {
      logger: false,
    });
    jpeg = await readFile(path.join(__dirname, '../fixtures/images', 'landscape-1024x768.jpg'));
  });

  afterAll(async () => {
    await owner?.$disconnect();
    await cli?.close();
    await app?.close();
    await infra?.stop();
  });

  it("shows a new school's owner five open items, and start sets startedAt once", async () => {
    const s = await school();
    const first = await get(s.owner);
    expect(first.status).toBe(200);
    expect(checklist(first)).toEqual({
      visible: true,
      items: [
        { key: 'profile', done: false },
        { key: 'logo', done: false },
        { key: 'academicYear', done: false },
        { key: 'campuses', done: false },
        { key: 'academics', done: false },
      ],
      startedAt: null,
      dismissedAt: null,
    });

    expect((await send('post', `${BASE}/start`, s.owner)).status).toBe(204);
    const startedAt = checklist(await get(s.owner)).startedAt;
    expect(startedAt).not.toBeNull();

    expect((await send('post', `${BASE}/start`, s.owner)).status).toBe(204);
    expect(checklist(await get(s.owner)).startedAt).toBe(startedAt);
  });

  it('ticks each item off as it is done and hides the checklist when all are', async () => {
    const s = await school();

    expect((await send('put', '/school/profile', s.owner).send(PROFILE)).status).toBe(200);
    expect(doneOf(await get(s.owner))).toEqual({
      profile: true,
      logo: false,
      academicYear: false,
      campuses: false,
      academics: false,
    });

    const logo = await send('put', '/school/logo', s.owner).attach('file', jpeg, 'logo.jpg');
    expect(logo.status).toBe(200);
    expect(doneOf(await get(s.owner))).toMatchObject({ logo: true, academicYear: false });

    const year = await send('post', '/school/academic-years', s.owner).send({
      startsOn: '2026-04-01',
      endsOn: '2027-03-31',
      termCount: 3,
    });
    expect(year.status).toBe(201);
    expect(doneOf(await get(s.owner))).toMatchObject({ academicYear: true, campuses: false });

    // The address alone is not enough; the PIN completes it.
    const url = `/school/campuses/${s.primaryId}`;
    await send('patch', url, s.owner).send({ addressLine1: '12 Rajpur Road' }).expect(200);
    expect(doneOf(await get(s.owner))).toMatchObject({ campuses: false });
    await send('patch', url, s.owner).send({ pinCode: '248001' }).expect(200);
    expect(doneOf(await get(s.owner))).toMatchObject({ campuses: true, academics: false });
    expect(checklist(await get(s.owner)).visible).toBe(true);

    // Academics needs a section in the current year and a class subject.
    const yearId = (year.body as { id: string }).id;
    await send('post', '/academics/sections', s.owner)
      .send({
        academicYearId: yearId,
        campusId: s.primaryId,
        classLevel: 'VI',
        name: 'A',
        capacity: 40,
      })
      .expect(201);
    expect(doneOf(await get(s.owner))).toMatchObject({ academics: false });
    const subject = await send('post', '/academics/subjects', s.owner)
      .send({ name: 'Mathematics', type: 'SCHOLASTIC' })
      .expect(201);
    expect(doneOf(await get(s.owner))).toMatchObject({ academics: false });
    await send('put', '/academics/class-subjects/VI', s.owner)
      .send({ rows: [{ subjectId: idOf(subject), streamId: null, kind: 'COMPULSORY' }] })
      .expect(200);

    const all = checklist(await get(s.owner));
    expect(all.items.every((i) => i.done)).toBe(true);
    expect(all.visible).toBe(false);
  });

  it('counts only sections of the current year for the academics item', async () => {
    const s = await school();
    await send('put', '/school/profile', s.owner).send(PROFILE).expect(200);
    const planned = await owner.academicYear.create({
      data: {
        tenantId: s.tenantId,
        label: '2030–31',
        startsOn: new Date('2030-04-01'),
        endsOn: new Date('2031-03-31'),
        status: 'PLANNED',
      },
    });
    const section = { campusId: s.primaryId, classLevel: 'VI', name: 'A', capacity: 40 };
    await send('post', '/academics/sections', s.owner)
      .send({ ...section, academicYearId: planned.id })
      .expect(201);
    const subject = await send('post', '/academics/subjects', s.owner)
      .send({ name: 'Mathematics', type: 'SCHOLASTIC' })
      .expect(201);
    await send('put', '/academics/class-subjects/VI', s.owner)
      .send({ rows: [{ subjectId: idOf(subject), streamId: null, kind: 'COMPULSORY' }] })
      .expect(200);
    expect(doneOf(await get(s.owner))).toMatchObject({ academics: false });

    const year = await send('post', '/school/academic-years', s.owner)
      .send({ startsOn: '2026-04-01', endsOn: '2027-03-31', termCount: 3 })
      .expect(201);
    expect(year.body).toMatchObject({ status: 'CURRENT' });
    await send('post', '/academics/sections', s.owner)
      .send({ ...section, academicYearId: idOf(year) })
      .expect(201);
    expect(doneOf(await get(s.owner))).toMatchObject({ academics: true });
  });

  it('hides a dismissed checklist while items remain, keeping the first dismissal time', async () => {
    const s = await school();
    expect((await send('post', `${BASE}/dismiss`, s.owner)).status).toBe(204);
    const res = checklist(await get(s.owner));
    expect(res.visible).toBe(false);
    expect(res.dismissedAt).not.toBeNull();
    expect(res.items.some((i) => !i.done)).toBe(true);

    expect((await send('post', `${BASE}/dismiss`, s.owner)).status).toBe(204);
    expect(checklist(await get(s.owner)).dismissedAt).toBe(res.dismissedAt);
  });

  it('shows a Teacher nothing and refuses their start and dismiss with 403', async () => {
    const s = await school();
    const res = await get(s.teacher);
    expect(res.status).toBe(200);
    expect(checklist(res).visible).toBe(false);
    const start = await send('post', `${BASE}/start`, s.teacher);
    expect(start.status).toBe(403);
    expect((start.body as { type?: string }).type).toBe('permission-denied');
    expect((await send('post', `${BASE}/dismiss`, s.teacher)).status).toBe(403);
    expect(checklist(await get(s.owner)).startedAt).toBeNull();
  });

  it('needs a session', async () => {
    expect((await request(server).get(BASE)).status).toBe(401);
  });

  it('keeps startedAt after signing out and back in', async () => {
    const s = await school();
    await send('post', `${BASE}/start`, s.owner).expect(204);
    const startedAt = checklist(await get(s.owner)).startedAt;
    await send('post', '/auth/sign-out', s.owner).expect(204);
    expect((await get(s.owner)).status).toBe(401);

    const again = await s.signIn();
    const res = checklist(await get(again));
    expect(res.startedAt).toBe(startedAt);
    expect(res.visible).toBe(true);
  });

  describe('school:demo-setup', () => {
    const run = (...args: string[]) => {
      const lines: string[] = [];
      const program = buildCli(cli, (line) => lines.push(line));
      registerSchoolCommands(program, cli, (line) => lines.push(line));
      return program.parseAsync(args, { from: 'user' }).then(() => lines);
    };

    it('fills a fresh school so every item is done', async () => {
      const s = await school();
      const lines = await run('school:demo-setup', s.code.toLowerCase());
      expect(JSON.parse(lines.at(-1)!)).toMatchObject({
        action: 'demo-setup',
        code: s.code,
        done: ['profile', 'logo', 'academicYear', 'campuses', 'academics'],
        skipped: [],
      });

      const res = checklist(await get(s.owner));
      expect(res.items.every((i) => i.done)).toBe(true);
      expect(res.visible).toBe(false);

      const years = await owner.academicYear.findMany({
        where: { tenantId: s.tenantId },
        include: { terms: true },
      });
      expect(years).toHaveLength(1);
      expect(years[0]!.status).toBe('CURRENT');
      expect(years[0]!.terms).toHaveLength(3);
      expect(await owner.campus.count({ where: { tenantId: s.tenantId } })).toBe(2);

      const logo = await request(server).get('/school/logo').set('Cookie', s.owner);
      expect(logo.status).toBe(200);
      expect(logo.headers['content-type']).toBe('image/png');

      // Academics (spec section 11): 2 streams, 3 rooms, the CBSE starter subjects, sections
      // for two classes in the current year and a few class subjects.
      const tenant = { tenantId: s.tenantId };
      const streams = await owner.stream.findMany({ where: tenant, orderBy: { name: 'asc' } });
      expect(streams.map((x) => x.name)).toEqual(['Commerce', 'Science']);
      expect(await owner.room.count({ where: tenant })).toBe(3);
      const subjects = await owner.subject.findMany({ where: tenant });
      expect(subjects.map((x) => x.name).sort()).toEqual(
        STARTER_SUBJECTS.CBSE.map((x) => x.name).sort(),
      );
      const sections = await owner.section.findMany({ where: tenant });
      expect(sections.every((x) => x.academicYearId === years[0]!.id)).toBe(true);
      expect(new Set(sections.map((x) => x.classLevel)).size).toBe(2);
      const senior = sections.filter((x) => x.classLevel === 'XI');
      expect(senior.length).toBeGreaterThan(0);
      expect(senior.every((x) => x.streamId !== null)).toBe(true);
      expect(await owner.classSubject.count({ where: tenant })).toBeGreaterThan(0);
      expect(
        await owner.auditEvent.count({
          where: { tenantId: s.tenantId, action: 'section.created' },
        }),
      ).toBe(sections.length);
    });

    it('skips what a school already has when run again', async () => {
      const s = await school();
      await run('school:demo-setup', s.code);
      const before = await owner.schoolProfile.findUniqueOrThrow({
        where: { tenantId: s.tenantId },
      });
      const tenant = { tenantId: s.tenantId };
      const counts = () =>
        Promise.all([
          owner.stream.count({ where: tenant }),
          owner.room.count({ where: tenant }),
          owner.subject.count({ where: tenant }),
          owner.section.count({ where: tenant }),
          owner.classSubject.count({ where: tenant }),
          owner.auditEvent.count({ where: tenant }),
        ]);
      const academicsBefore = await counts();
      const lines = await run('school:demo-setup', s.code);
      expect(JSON.parse(lines.at(-1)!)).toMatchObject({
        action: 'demo-setup',
        done: [],
        skipped: ['profile', 'logo', 'academicYear', 'campuses', 'academics'],
        reasons: { academicYear: expect.stringMatching(/CURRENT/) as unknown },
      });
      const after = await owner.schoolProfile.findUniqueOrThrow({
        where: { tenantId: s.tenantId },
      });
      expect(after.logoFileId).toBe(before.logoFileId);
      expect(await owner.academicYear.count({ where: { tenantId: s.tenantId } })).toBe(1);
      expect(await owner.campus.count({ where: { tenantId: s.tenantId } })).toBe(2);
      expect(await counts()).toEqual(academicsBefore);
    });

    it('keeps the class subjects a school already set and adds only missing pieces', async () => {
      const s = await school();
      await send('put', '/school/profile', s.owner).send(PROFILE).expect(200);
      const english = await send('post', '/academics/subjects', s.owner)
        .send({ name: 'english', type: 'SCHOLASTIC' })
        .expect(201);
      await send('put', '/academics/class-subjects/VI', s.owner)
        .send({ rows: [{ subjectId: idOf(english), streamId: null, kind: 'OPTIONAL' }] })
        .expect(200);

      await run('school:demo-setup', s.code);
      const vi = await owner.classSubject.findMany({
        where: { tenantId: s.tenantId, classLevel: 'VI' },
      });
      expect(vi).toEqual([expect.objectContaining({ subjectId: idOf(english), kind: 'OPTIONAL' })]);
      // The school's own "english" stands in for the starter "English".
      expect(
        await owner.subject.count({
          where: { tenantId: s.tenantId, name: { equals: 'English', mode: 'insensitive' } },
        }),
      ).toBe(1);
      expect(doneOf(await get(s.owner))).toMatchObject({ academics: true });
    });

    it('says why it skips the year when the school has only a planned one', async () => {
      const s = await school();
      await owner.academicYear.create({
        data: {
          tenantId: s.tenantId,
          label: '2030–31',
          startsOn: new Date('2030-04-01'),
          endsOn: new Date('2031-03-31'),
          status: 'PLANNED',
        },
      });
      const lines = await run('school:demo-setup', s.code);
      const result = JSON.parse(lines.at(-1)!) as {
        skipped: string[];
        reasons: Record<string, string>;
      };
      expect(result.skipped).toEqual(['academicYear']);
      expect(result.reasons.academicYear).toMatch(/2030–31 \(PLANNED\).*none is current/);
      // Streams, rooms and subjects need no year; sections wait for a current one.
      expect(result.reasons.academics).toMatch(/no current year/);
      expect(await owner.section.count({ where: { tenantId: s.tenantId } })).toBe(0);
      expect(checklist(await get(s.owner)).items.find((i) => i.key === 'academicYear')!.done).toBe(
        false,
      );
    });

    it('refuses an unknown school', async () => {
      await expect(run('school:demo-setup', 'NOPE9')).rejects.toThrow(/not found/);
    });
  });
});
