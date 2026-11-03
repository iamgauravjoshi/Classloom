import { campusesResponseSchema, campusSchema } from '@classloom/contracts';
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
const BASE = '/school/campuses';

interface Problem {
  type?: string;
}
const problem = (res: request.Response) => res.body as Problem;
const campus = (res: request.Response) => campusSchema.parse(res.body);
const campuses = (res: request.Response) => campusesResponseSchema.parse(res.body).campuses;

describe('campuses API', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let sessions: SessionService;
  let counter = 0;

  /** A seeded school (one primary campus) with an Admin, a Principal and a Teacher. */
  async function school() {
    counter += 1;
    const code = `CMP${counter}`;
    const ids = await seedSchool(owner, { code, email: `o${counter}@campuses.test` });
    await owner.role.updateMany({
      where: { tenantId: ids.tenantId, key: { in: ['ADMIN', 'PRINCIPAL'] } },
      data: { requiresTwoFactor: false },
    });
    const person = async (roleKey: string) => {
      counter += 1;
      const user = await owner.user.create({
        data: { email: `p${counter}@campuses.test`, name: `Person ${counter}` },
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
    const primary = await owner.campus.findFirstOrThrow({
      where: { tenantId: ids.tenantId, isPrimary: true },
    });
    return {
      tenantId: ids.tenantId,
      primaryId: primary.id,
      primaryName: primary.name,
      admin: await person('ADMIN'),
      principal: await person('PRINCIPAL'),
      teacher: await person('TEACHER'),
    };
  }

  const get = (path: string, cookie: string) => request(server).get(path).set('Cookie', cookie);
  const post = (path: string, cookie: string) =>
    request(server).post(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN);
  const patch = (path: string, cookie: string) =>
    request(server).patch(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN);

  const create = async (cookie: string, body: object) => {
    const res = await post(BASE, cookie).send(body);
    expect(res.status).toBe(201);
    return campus(res);
  };
  const audits = (tenantId: string) =>
    owner.auditEvent.findMany({
      where: { tenantId, targetType: 'campus' },
      orderBy: { createdAt: 'asc' },
    });
  const rows = (tenantId: string) => owner.campus.findMany({ where: { tenantId } });
  const primaries = async (tenantId: string) =>
    (await rows(tenantId)).filter((c) => c.isPrimary).map((c) => c.id);

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

  describe('GET', () => {
    it('gives any member the active campuses, primary first and then by name', async () => {
      const s = await school();
      await create(s.admin.cookie, { name: 'Zeta Campus' });
      await create(s.admin.cookie, { name: 'Alpha Campus' });
      const gone = await create(s.admin.cookie, { name: 'Beta Campus' });
      expect((await post(`${BASE}/${gone.id}/deactivate`, s.admin.cookie)).status).toBe(200);

      const res = await get(BASE, s.teacher.cookie);
      expect(res.status).toBe(200);
      const list = campuses(res);
      expect(list.map((c) => c.name)).toEqual([s.primaryName, 'Alpha Campus', 'Zeta Campus']);
      expect(list[0]).toMatchObject({ id: s.primaryId, isPrimary: true, isActive: true });
    });

    it('refuses ?status=all without settings.view with 403', async () => {
      const s = await school();
      const res = await get(`${BASE}?status=all`, s.teacher.cookie);
      expect(res.status).toBe(403);
      expect(problem(res).type).toBe('permission-denied');
    });

    it('includes inactive campuses with ?status=all for a settings.view holder', async () => {
      const s = await school();
      const gone = await create(s.admin.cookie, { name: 'Beta Campus' });
      await post(`${BASE}/${gone.id}/deactivate`, s.admin.cookie);
      const res = await get(`${BASE}?status=all`, s.principal.cookie);
      expect(res.status).toBe(200);
      expect(campuses(res).map((c) => [c.name, c.isActive])).toEqual([
        [s.primaryName, true],
        ['Beta Campus', false],
      ]);
    });

    it('refuses an unknown status with 400', async () => {
      const s = await school();
      expect((await get(`${BASE}?status=gone`, s.admin.cookie)).status).toBe(400);
    });
  });

  describe('POST', () => {
    it('adds a campus with 201 and one campus.created row', async () => {
      const s = await school();
      const res = await post(BASE, s.admin.cookie).send({
        name: '  North Campus ',
        addressLine1: '12 Rajpur Road',
        pinCode: '248001',
        phone: '98765 43210',
      });
      expect(res.status).toBe(201);
      const c = campus(res);
      expect(c).toMatchObject({
        name: 'North Campus',
        addressLine1: '12 Rajpur Road',
        addressLine2: null,
        pinCode: '248001',
        phone: '+919876543210',
        isPrimary: false,
        isActive: true,
      });
      const events = await audits(s.tenantId);
      expect(events.map((e) => [e.action, e.targetId])).toEqual([['campus.created', c.id]]);
      expect(events[0]!.actorUserId).toBe(s.admin.userId);
    });

    it('stores and returns the city and state sent', async () => {
      const s = await school();
      const c = await create(s.admin.cookie, {
        name: 'Haridwar Campus',
        city: 'Haridwar',
        state: 'UK',
      });
      expect(c).toMatchObject({ city: 'Haridwar', state: 'UK' });
      expect(await owner.campus.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({
        city: 'Haridwar',
        state: 'UK',
      });
      const [event] = await audits(s.tenantId);
      expect(event!.after).toMatchObject({ city: 'Haridwar', state: 'UK' });
    });

    it("defaults the city and state to the school's when left out", async () => {
      const s = await school();
      await owner.tenant.update({
        where: { id: s.tenantId },
        data: { city: 'Lucknow', state: 'UP' },
      });
      const c = await create(s.admin.cookie, { name: 'North Campus' });
      expect(c).toMatchObject({ city: 'Lucknow', state: 'UP' });
      const half = await create(s.admin.cookie, { name: 'South Campus', city: 'Kanpur' });
      expect(half).toMatchObject({ city: 'Kanpur', state: 'UP' });
    });

    it('needs settings.manage', async () => {
      const s = await school();
      const res = await post(BASE, s.principal.cookie).send({ name: 'North Campus' });
      expect(res.status).toBe(403);
      expect(await rows(s.tenantId)).toHaveLength(1);
    });

    it('refuses a name differing only in case with 409 campus-name-taken', async () => {
      const s = await school();
      await create(s.admin.cookie, { name: 'North Campus' });
      const res = await post(BASE, s.admin.cookie).send({ name: 'NORTH campus' });
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('campus-name-taken');
      expect(await rows(s.tenantId)).toHaveLength(2);
    });

    it('refuses the 21st campus, counting inactive ones, with 409 campus-limit', async () => {
      const s = await school();
      await owner.campus.createMany({
        data: Array.from({ length: 19 }, (_, i) => ({
          tenantId: s.tenantId,
          name: `Branch ${i + 1}`,
          city: 'Dehradun',
          state: 'UK' as const,
          status: i < 5 ? ('INACTIVE' as const) : ('ACTIVE' as const),
        })),
      });
      const res = await post(BASE, s.admin.cookie).send({ name: 'One Too Many' });
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('campus-limit');
      expect(await rows(s.tenantId)).toHaveLength(20);
    });

    it('refuses a bad PIN with 400', async () => {
      const s = await school();
      const res = await post(BASE, s.admin.cookie).send({ name: 'North', pinCode: '012345' });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH', () => {
    it('edits the address and contact, stores the phone as E.164 and writes campus.updated', async () => {
      const s = await school();
      const c = await create(s.admin.cookie, { name: 'North Campus', email: 'n@school.test' });
      const res = await patch(`${BASE}/${c.id}`, s.admin.cookie).send({
        addressLine1: '1 Mall Road',
        district: 'Dehradun',
        pinCode: '248001',
        phone: '09876543210',
      });
      expect(res.status).toBe(200);
      expect(campus(res)).toMatchObject({
        name: 'North Campus',
        addressLine1: '1 Mall Road',
        district: 'Dehradun',
        pinCode: '248001',
        phone: '+919876543210',
        email: 'n@school.test',
      });
      const row = await owner.campus.findUniqueOrThrow({ where: { id: c.id } });
      expect(row.phone).toBe('+919876543210');
      const updated = (await audits(s.tenantId)).filter((e) => e.action === 'campus.updated');
      expect(updated).toHaveLength(1);
      expect(Object.keys(updated[0]!.after as object).sort()).toEqual([
        'addressLine1',
        'district',
        'phone',
        'pinCode',
      ]);
    });

    it('changes the city with one campus.updated row holding only the city', async () => {
      const s = await school();
      const c = await create(s.admin.cookie, { name: 'North Campus' });
      const res = await patch(`${BASE}/${c.id}`, s.admin.cookie).send({ city: ' Haridwar ' });
      expect(res.status).toBe(200);
      expect(campus(res)).toMatchObject({ city: 'Haridwar', state: 'UK' });
      const updated = (await audits(s.tenantId)).filter((e) => e.action === 'campus.updated');
      expect(updated).toHaveLength(1);
      expect(updated[0]!.before).toEqual({ city: 'Dehradun' });
      expect(updated[0]!.after).toEqual({ city: 'Haridwar' });
    });

    it('refuses an empty city or an unknown state with 400', async () => {
      const s = await school();
      const c = await create(s.admin.cookie, { name: 'North Campus' });
      expect((await patch(`${BASE}/${c.id}`, s.admin.cookie).send({ city: '' })).status).toBe(400);
      expect((await patch(`${BASE}/${c.id}`, s.admin.cookie).send({ state: 'ZZ' })).status).toBe(
        400,
      );
    });

    it('clears a field sent as an empty string', async () => {
      const s = await school();
      const c = await create(s.admin.cookie, { name: 'North Campus', district: 'Dehradun' });
      const res = await patch(`${BASE}/${c.id}`, s.admin.cookie).send({ district: '' });
      expect(res.status).toBe(200);
      expect(campus(res).district).toBeNull();
    });

    it('writes nothing when nothing changes', async () => {
      const s = await school();
      const c = await create(s.admin.cookie, { name: 'North Campus' });
      const res = await patch(`${BASE}/${c.id}`, s.admin.cookie).send({ name: 'North Campus' });
      expect(res.status).toBe(200);
      expect((await audits(s.tenantId)).map((e) => e.action)).toEqual(['campus.created']);
    });

    it('validates the PIN and the phone with 400', async () => {
      const s = await school();
      const c = await create(s.admin.cookie, { name: 'North Campus' });
      expect(
        (await patch(`${BASE}/${c.id}`, s.admin.cookie).send({ pinCode: '24800' })).status,
      ).toBe(400);
      expect((await patch(`${BASE}/${c.id}`, s.admin.cookie).send({ phone: '12345' })).status).toBe(
        400,
      );
    });

    it("refuses another campus's name with 409 campus-name-taken", async () => {
      const s = await school();
      const c = await create(s.admin.cookie, { name: 'North Campus' });
      const res = await patch(`${BASE}/${c.id}`, s.admin.cookie).send({
        name: s.primaryName.toUpperCase(),
      });
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('campus-name-taken');
    });
  });

  describe('make primary', () => {
    it('moves the flag and writes campus.made_primary', async () => {
      const s = await school();
      const c = await create(s.admin.cookie, { name: 'North Campus' });
      const res = await post(`${BASE}/${c.id}/make-primary`, s.admin.cookie);
      expect(res.status).toBe(200);
      expect(campus(res)).toMatchObject({ id: c.id, isPrimary: true });
      expect(await primaries(s.tenantId)).toEqual([c.id]);
      const events = (await audits(s.tenantId)).filter((e) => e.action === 'campus.made_primary');
      expect(events.map((e) => e.targetId)).toEqual([c.id]);
      expect(events[0]!.before).toEqual({ primaryCampusId: s.primaryId });
    });

    it('refuses an inactive campus with 409 campus-inactive', async () => {
      const s = await school();
      const c = await create(s.admin.cookie, { name: 'North Campus' });
      await post(`${BASE}/${c.id}/deactivate`, s.admin.cookie);
      const res = await post(`${BASE}/${c.id}/make-primary`, s.admin.cookie);
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('campus-inactive');
      expect(await primaries(s.tenantId)).toEqual([s.primaryId]);
    });

    it('leaves exactly one primary when two campuses are made primary at once', async () => {
      const s = await school();
      const a = await create(s.admin.cookie, { name: 'North Campus' });
      const b = await create(s.admin.cookie, { name: 'South Campus' });
      for (let round = 0; round < 3; round += 1) {
        const results = await Promise.all([
          post(`${BASE}/${a.id}/make-primary`, s.admin.cookie),
          post(`${BASE}/${b.id}/make-primary`, s.admin.cookie),
        ]);
        expect(results.map((r) => r.status)).toEqual([200, 200]);
        const ids = await primaries(s.tenantId);
        expect(ids).toHaveLength(1);
        expect([a.id, b.id]).toContain(ids[0]);
      }
    });
  });

  describe('deactivate', () => {
    it('refuses the primary campus with 409 campus-primary', async () => {
      const s = await school();
      await create(s.admin.cookie, { name: 'North Campus' });
      const res = await post(`${BASE}/${s.primaryId}/deactivate`, s.admin.cookie);
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('campus-primary');
    });

    it('deactivates the non-primary one of two, then refuses the remaining one', async () => {
      const s = await school();
      const c = await create(s.admin.cookie, { name: 'North Campus' });
      const res = await post(`${BASE}/${c.id}/deactivate`, s.admin.cookie);
      expect(res.status).toBe(200);
      expect(campus(res)).toMatchObject({ id: c.id, isActive: false });
      expect((await audits(s.tenantId)).map((e) => e.action)).toEqual([
        'campus.created',
        'campus.deactivated',
      ]);
      const last = await post(`${BASE}/${s.primaryId}/deactivate`, s.admin.cookie);
      expect(last.status).toBe(409);
      expect(problem(last).type).toBe('campus-primary');
    });

    it('refuses the only active campus when it is not primary with 409 campus-last-active', async () => {
      const s = await school();
      const c = await create(s.admin.cookie, { name: 'North Campus' });
      await owner.campus.update({ where: { id: s.primaryId }, data: { status: 'INACTIVE' } });
      const res = await post(`${BASE}/${c.id}/deactivate`, s.admin.cookie);
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe('campus-last-active');
    });
  });

  describe('reactivate', () => {
    it('reactivates a campus and writes campus.reactivated', async () => {
      const s = await school();
      const c = await create(s.admin.cookie, { name: 'North Campus' });
      await post(`${BASE}/${c.id}/deactivate`, s.admin.cookie);
      const res = await post(`${BASE}/${c.id}/reactivate`, s.admin.cookie);
      expect(res.status).toBe(200);
      expect(campus(res)).toMatchObject({ id: c.id, isActive: true });
      expect((await audits(s.tenantId)).map((e) => e.action)).toEqual([
        'campus.created',
        'campus.deactivated',
        'campus.reactivated',
      ]);
    });
  });

  describe('isolation', () => {
    it("gives 404 when another school acts on this school's campus", async () => {
      const a = await school();
      const b = await school();
      const c = await create(a.admin.cookie, { name: 'North Campus' });
      const paths = [
        patch(`${BASE}/${c.id}`, b.admin.cookie).send({ name: 'Taken' }),
        post(`${BASE}/${c.id}/make-primary`, b.admin.cookie),
        post(`${BASE}/${c.id}/deactivate`, b.admin.cookie),
        post(`${BASE}/${c.id}/reactivate`, b.admin.cookie),
        post(`${BASE}/not-a-uuid/deactivate`, b.admin.cookie),
      ];
      for (const res of await Promise.all(paths)) expect(res.status).toBe(404);
      expect(campuses(await get(BASE, b.admin.cookie)).map((x) => x.id)).not.toContain(c.id);
      expect(await owner.campus.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({
        name: 'North Campus',
        status: 'ACTIVE',
        isPrimary: false,
      });
    });
  });
});
