import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { onboardingResponseSchema } from '@classloom/contracts';
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
};

const checklist = (res: request.Response) => onboardingResponseSchema.parse(res.body);
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

  it("shows a new school's owner four open items, and start sets startedAt once", async () => {
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

    const all = checklist(await get(s.owner));
    expect(all.items.every((i) => i.done)).toBe(true);
    expect(all.visible).toBe(false);
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
        done: ['profile', 'logo', 'academicYear', 'campuses'],
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
    });

    it('skips what a school already has when run again', async () => {
      const s = await school();
      await run('school:demo-setup', s.code);
      const before = await owner.schoolProfile.findUniqueOrThrow({
        where: { tenantId: s.tenantId },
      });
      const lines = await run('school:demo-setup', s.code);
      expect(JSON.parse(lines.at(-1)!)).toMatchObject({
        action: 'demo-setup',
        done: [],
        skipped: ['profile', 'logo', 'academicYear', 'campuses'],
      });
      const after = await owner.schoolProfile.findUniqueOrThrow({
        where: { tenantId: s.tenantId },
      });
      expect(after.logoFileId).toBe(before.logoFileId);
      expect(await owner.academicYear.count({ where: { tenantId: s.tenantId } })).toBe(1);
      expect(await owner.campus.count({ where: { tenantId: s.tenantId } })).toBe(2);
    });

    it('refuses an unknown school', async () => {
      await expect(run('school:demo-setup', 'NOPE9')).rejects.toThrow(/not found/);
    });
  });
});
