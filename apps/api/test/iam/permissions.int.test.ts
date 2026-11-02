import { ALL_PERMISSIONS, authSessionSchema, BUILT_IN_ROLE_DEFAULTS } from '@classloom/contracts';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import type { ApplicationConfig } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { configureApp } from '../../src/main';
import { AuthGuard } from '../../src/modules/auth/auth.guard';
import { Public } from '../../src/modules/auth/public.decorator';
import { SessionService } from '../../src/modules/auth/session.service';
import { PermissionGuard } from '../../src/modules/iam/permission.guard';
import { RequirePermission } from '../../src/modules/iam/require-permission.decorator';
import { addMember, seedSchool } from '../auth/helpers';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';

@Controller('__probe')
class ProbeController {
  @Get('fees')
  @RequirePermission('fees.view')
  fees() {
    return { ok: true };
  }

  @Get('fees-and-iam')
  @RequirePermission('fees.view', 'iam.manage')
  feesAndIam() {
    return { ok: true };
  }

  @Get('open')
  open() {
    return { ok: true };
  }

  @Get('public')
  @Public()
  @RequirePermission('fees.view')
  publicRoute() {
    return { ok: true };
  }
}

const COOKIE = 'cl_session';

describe('permissions in the request pipeline', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let sessions: SessionService;
  let counter = 0;

  /** A school with its owner, plus a second member holding the given built-in roles. */
  async function memberWith(roleKeys: string[]) {
    counter += 1;
    const code = `PERM${counter}`;
    const school = await seedSchool(owner, { code, email: `o${counter}@perm.in` });
    const user = await owner.user.create({
      data: {
        email: `m${counter}@perm.in`,
        name: `Member ${counter}`,
        emailVerifiedAt: new Date(),
      },
    });
    let membershipId: string;
    if (roleKeys.length === 0) {
      membershipId = (
        await owner.membership.create({ data: { tenantId: school.tenantId, userId: user.id } })
      ).id;
    } else {
      const [first, ...rest] = roleKeys;
      membershipId = (await addMember(owner, school.tenantId, user.id, first)).id;
      for (const key of rest) {
        const role = await owner.role.findFirstOrThrow({
          where: { tenantId: school.tenantId, key },
        });
        await owner.membershipRole.create({
          data: { tenantId: school.tenantId, membershipId, roleId: role.id },
        });
      }
    }
    const { token } = await sessions.create({
      tenantId: school.tenantId,
      userId: user.id,
      membershipId,
      remember: false,
    });
    const ownerSession = await sessions.create({ ...school, remember: false });
    return {
      school,
      membershipId,
      cookie: `${COOKIE}=${token}`,
      ownerCookie: `${COOKIE}=${ownerSession.token}`,
    };
  }

  beforeAll(async () => {
    infra = await startTestInfra();
    const env = { ...infra.env, DATABASE_MIGRATION_URL: undefined };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, env);
    await app.init();
    server = app.getHttpServer() as App;
    owner = ownerPrisma(infra.env);
    sessions = app.get(SessionService, { strict: false });
  });

  afterAll(async () => {
    await owner?.$disconnect();
    await app?.close();
    await infra?.stop();
  });

  it('runs PermissionGuard as a global guard after AuthGuard', () => {
    const config = (app as unknown as { config: ApplicationConfig }).config;
    const guards = config.getGlobalGuards();
    const auth = guards.findIndex((g) => g instanceof AuthGuard);
    const permission = guards.findIndex((g) => g instanceof PermissionGuard);
    expect(auth).toBeGreaterThanOrEqual(0);
    expect(permission).toBeGreaterThan(auth);
  });

  it('lets an owner through a guarded route', async () => {
    const m = await memberWith(['TEACHER']);
    const res = await request(server).get('/__probe/fees').set('Cookie', m.ownerCookie);
    expect(res.status).toBe(200);
    const both = await request(server).get('/__probe/fees-and-iam').set('Cookie', m.ownerCookie);
    expect(both.status).toBe(200);
  });

  it('refuses a Teacher with 403 permission-denied', async () => {
    const m = await memberWith(['TEACHER']);
    const res = await request(server).get('/__probe/fees').set('Cookie', m.cookie);
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ type: 'permission-denied', status: 403 });
  });

  it('is 401, not 403, without a session; public and undecorated routes need no permission', async () => {
    expect((await request(server).get('/__probe/fees')).status).toBe(401);
    expect((await request(server).get('/__probe/public')).status).toBe(200);
    const m = await memberWith(['TEACHER']);
    expect((await request(server).get('/__probe/open').set('Cookie', m.cookie)).status).toBe(200);
  });

  it('applies a role change to the same session on its next request', async () => {
    const m = await memberWith(['TEACHER']);
    expect((await request(server).get('/__probe/fees').set('Cookie', m.cookie)).status).toBe(403);

    const teacher = await owner.role.findFirstOrThrow({
      where: { tenantId: m.school.tenantId, key: 'TEACHER' },
    });
    await owner.rolePermission.create({
      data: { tenantId: m.school.tenantId, roleId: teacher.id, permission: 'fees.view' },
    });
    expect((await request(server).get('/__probe/fees').set('Cookie', m.cookie)).status).toBe(200);
    // Needs every listed key, not just one.
    expect(
      (await request(server).get('/__probe/fees-and-iam').set('Cookie', m.cookie)).status,
    ).toBe(403);

    await owner.rolePermission.delete({
      where: { roleId_permission: { roleId: teacher.id, permission: 'fees.view' } },
    });
    expect((await request(server).get('/__probe/fees').set('Cookie', m.cookie)).status).toBe(403);
  });

  it('returns the union of Teacher and Librarian on GET /auth/session', async () => {
    const m = await memberWith(['TEACHER', 'LIBRARIAN']);
    const res = await request(server).get('/auth/session').set('Cookie', m.cookie);
    expect(res.status).toBe(200);
    const body = authSessionSchema.parse(res.body);
    expect(body.roles).toEqual([
      { key: 'LIBRARIAN', name: BUILT_IN_ROLE_DEFAULTS.LIBRARIAN.name },
      { key: 'TEACHER', name: BUILT_IN_ROLE_DEFAULTS.TEACHER.name },
    ]);
    const union = new Set([
      ...(BUILT_IN_ROLE_DEFAULTS.TEACHER.permissions as readonly string[]),
      ...(BUILT_IN_ROLE_DEFAULTS.LIBRARIAN.permissions as readonly string[]),
    ]);
    expect(body.permissions).toEqual(ALL_PERMISSIONS.filter((p) => union.has(p)));
    expect(body.twoFactorSetupRequired).toBe(false);
  });

  it('returns every permission and the Owner role for an owner', async () => {
    const m = await memberWith(['TEACHER']);
    const res = await request(server).get('/auth/session').set('Cookie', m.ownerCookie);
    const body = authSessionSchema.parse(res.body);
    expect(body.roles).toEqual([{ key: 'OWNER', name: BUILT_IN_ROLE_DEFAULTS.OWNER.name }]);
    expect(body.permissions).toEqual([...ALL_PERMISSIONS]);
  });

  it('treats a membership with no roles as no access, while the session still works', async () => {
    const m = await memberWith([]);
    const session = await request(server).get('/auth/session').set('Cookie', m.cookie);
    expect(session.status).toBe(200);
    const body = authSessionSchema.parse(session.body);
    expect(body.roles).toEqual([]);
    expect(body.permissions).toEqual([]);
    const res = await request(server).get('/__probe/fees').set('Cookie', m.cookie);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ type: 'permission-denied' });
  });

  it("does not read another school's roles", async () => {
    // A role from school A is never visible to a member of school B, even by id.
    const a = await memberWith(['ACCOUNTANT']);
    const b = await memberWith(['TEACHER']);
    const res = await request(server).get('/auth/session').set('Cookie', b.cookie);
    const body = authSessionSchema.parse(res.body);
    expect(body.roles.map((r) => r.key)).toEqual(['TEACHER']);
    expect(body.permissions).not.toContain('fees.view');
    expect((await request(server).get('/__probe/fees').set('Cookie', a.cookie)).status).toBe(200);
  });
});
