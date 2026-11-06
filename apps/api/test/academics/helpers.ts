import type { ClassLevel } from '@classloom/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import { SessionService } from '../../src/modules/auth/session.service';
import { addMember, seedSchool } from '../auth/helpers';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';

export const WEB_ORIGIN = 'http://localhost:3000';
const COOKIE = 'cl_session';

export interface Problem {
  type?: string;
  field?: string;
  limit?: number;
  counts?: Record<string, number>;
  sectionName?: string;
  errors?: { path: string; message: string }[];
}
export const problem = (res: request.Response) => res.body as Problem;

export interface Person {
  userId: string;
  membershipId: string;
  cookie: string;
}

export interface AcademicsSchool {
  tenantId: string;
  primaryCampusId: string;
  admin: Person;
  teacher: Person;
  accountant: Person;
  person: (roleKey: string) => Promise<Person>;
}

/**
 * The app, the owner-role client and helpers shared by the academics integration tests. Call
 * `start()` in `beforeAll` and `stop()` in `afterAll`.
 */
export function academicsHarness(tag: string) {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let sessions: SessionService;
  let counter = 0;

  const h = {
    get owner() {
      return owner;
    },
    get app() {
      return app;
    },
    async start() {
      infra = await startTestInfra();
      app = await createApp(infra.env, { logger: false });
      await app.init();
      server = app.getHttpServer() as App;
      owner = ownerPrisma(infra.env);
      sessions = app.get(SessionService);
    },
    async stop() {
      await owner?.$disconnect();
      await app?.close();
      await infra?.stop();
    },

    /**
     * A seeded CBSE school with a profile (class range I-XII unless `range` says otherwise; null
     * leaves it unset), an Admin, a Teacher and an Accountant.
     */
    async school(range: [ClassLevel, ClassLevel] | null = ['I', 'XII']): Promise<AcademicsSchool> {
      counter += 1;
      const code = `${tag}${counter}`;
      const ids = await seedSchool(owner, { code, email: `o${counter}@${tag.toLowerCase()}.test` });
      await owner.role.updateMany({
        where: { tenantId: ids.tenantId, key: { in: ['ADMIN', 'PRINCIPAL', 'ACCOUNTANT'] } },
        data: { requiresTwoFactor: false },
      });
      await owner.schoolProfile.create({
        data: {
          tenantId: ids.tenantId,
          city: 'Dehradun',
          state: 'UK',
          lowestClass: range?.[0] ?? null,
          highestClass: range?.[1] ?? null,
        },
      });
      const person = async (roleKey: string): Promise<Person> => {
        counter += 1;
        const user = await owner.user.create({
          data: { email: `p${counter}@${tag.toLowerCase()}.test`, name: `Person ${counter}` },
        });
        const m = await addMember(owner, ids.tenantId, user.id, roleKey);
        const { token } = await sessions.create({
          tenantId: ids.tenantId,
          userId: user.id,
          membershipId: m.id,
          remember: false,
        });
        return { userId: user.id, membershipId: m.id, cookie: `${COOKIE}=${token}` };
      };
      const primary = await owner.campus.findFirstOrThrow({
        where: { tenantId: ids.tenantId, isPrimary: true },
      });
      return {
        tenantId: ids.tenantId,
        primaryCampusId: primary.id,
        admin: await person('ADMIN'),
        teacher: await person('TEACHER'),
        accountant: await person('ACCOUNTANT'),
        person,
      };
    },

    get: (path: string, cookie: string) => request(server).get(path).set('Cookie', cookie),
    post: (path: string, cookie: string) =>
      request(server).post(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN),
    patch: (path: string, cookie: string) =>
      request(server).patch(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN),
    put: (path: string, cookie: string) =>
      request(server).put(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN),
    del: (path: string, cookie: string) =>
      request(server).delete(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN),

    /** An academic year from 1 April `startYear` to 31 March the next year; returns its id. */
    async year(
      tenantId: string,
      startYear: number,
      status: 'PLANNED' | 'CURRENT' | 'CLOSED',
    ): Promise<string> {
      const row = await owner.academicYear.create({
        data: {
          tenantId,
          label: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
          startsOn: new Date(`${startYear}-04-01T00:00:00.000Z`),
          endsOn: new Date(`${startYear + 1}-03-31T00:00:00.000Z`),
          status,
        },
      });
      return row.id;
    },

    /** Another active campus of the school; returns its id. */
    async campus(tenantId: string, name: string): Promise<string> {
      const row = await owner.campus.create({
        data: { tenantId, name, city: 'Dehradun', state: 'UK' },
      });
      return row.id;
    },

    audits: (tenantId: string, targetType?: string) =>
      owner.auditEvent.findMany({
        where: { tenantId, ...(targetType ? { targetType } : {}) },
        orderBy: { createdAt: 'asc' },
      }),
  };
  return h;
}
