import { randomUUID } from 'node:crypto';

import {
  ALL_PERMISSIONS,
  BUILT_IN_ROLE_DEFAULTS,
  BUILT_IN_ROLE_KEYS,
  permissionCatalogueResponseSchema,
  rolesResponseSchema,
} from '@classloom/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { RedisService } from '../../src/core/redis/redis.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import { SessionService } from '../../src/modules/auth/session.service';
import { seedSchool } from '../auth/helpers';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';

const WEB_ORIGIN = 'http://localhost:3000';
const COOKIE = 'cl_session';

interface Problem {
  type?: string;
  status?: number;
  errors?: { path: string }[];
}

describe('roles API', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let sessions: SessionService;
  let redis: RedisService;
  let counter = 0;

  /** A school with its owner and a session cookie for the owner. */
  async function school() {
    counter += 1;
    const ids = await seedSchool(owner, { code: `ROL${counter}`, email: `o${counter}@roles.test` });
    const { token } = await sessions.create({ ...ids, remember: false });
    return { ...ids, cookie: `${COOKIE}=${token}` };
  }

  /** A second member of the school, holding the given role id, with a session cookie. */
  async function memberWithRole(tenantId: string, roleId: string) {
    counter += 1;
    const user = await owner.user.create({
      data: {
        email: `m${counter}@roles.test`,
        name: `Member ${counter}`,
        emailVerifiedAt: new Date(),
      },
    });
    const membership = await owner.membership.create({ data: { tenantId, userId: user.id } });
    await owner.membershipRole.create({
      data: { tenantId, membershipId: membership.id, roleId },
    });
    const { token } = await sessions.create({
      tenantId,
      userId: user.id,
      membershipId: membership.id,
      remember: false,
    });
    return { userId: user.id, membershipId: membership.id, cookie: `${COOKIE}=${token}` };
  }

  async function builtIn(tenantId: string, key: string) {
    return owner.role.findFirstOrThrow({ where: { tenantId, key } });
  }

  /** A non-owner holding only iam.manage plus the given permissions, in a custom role. */
  async function managerWith(tenantId: string, permissions: string[]) {
    const role = await owner.role.create({
      data: {
        tenantId,
        name: `Manager ${randomUUID().slice(0, 8)}`,
        permissions: {
          create: ['iam.manage', 'iam.view', ...permissions].map((permission) => ({ permission })),
        },
      },
    });
    return memberWithRole(tenantId, role.id);
  }

  const get = (cookie: string, path: string) => request(server).get(path).set('Cookie', cookie);
  const send = (method: 'post' | 'put' | 'delete', cookie: string, path: string, body?: object) => {
    const req = request(server)[method](path).set('Cookie', cookie).set('Origin', WEB_ORIGIN);
    return body ? req.send(body) : req;
  };
  const createRole = (cookie: string, body: object) => send('post', cookie, '/iam/roles', body);

  const auditRows = (tenantId: string, targetId?: string) =>
    owner.auditEvent.findMany({
      where: { tenantId, ...(targetId ? { targetId } : {}) },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    infra = await startTestInfra();
    app = await createApp(infra.env, { logger: false });
    await app.init();
    server = app.getHttpServer() as App;
    owner = ownerPrisma(infra.env);
    sessions = app.get(SessionService, { strict: false });
    redis = app.get(RedisService, { strict: false });
  });

  afterAll(async () => {
    await owner?.$disconnect();
    await app?.close();
    await infra?.stop();
  });

  describe('listing', () => {
    it('lists the 9 built-in roles with member counts and permissions', async () => {
      const s = await school();
      const res = await get(s.cookie, '/iam/roles');
      expect(res.status).toBe(200);
      const body = rolesResponseSchema.parse(res.body);
      expect(body.roles.map((r) => r.key)).toEqual([...BUILT_IN_ROLE_KEYS]);
      const ownerRole = body.roles.find((r) => r.key === 'OWNER');
      expect(ownerRole?.memberCount).toBe(1);
      expect(ownerRole?.permissions.slice().sort()).toEqual([...ALL_PERMISSIONS].sort());
      const teacher = body.roles.find((r) => r.key === 'TEACHER');
      expect(teacher?.memberCount).toBe(0);
      expect(teacher?.permissions.slice().sort()).toEqual(
        [...(BUILT_IN_ROLE_DEFAULTS.TEACHER.permissions as string[])].sort(),
      );
    });

    it('serves the permission catalogue', async () => {
      const s = await school();
      const res = await get(s.cookie, '/iam/permissions');
      expect(res.status).toBe(200);
      const body = permissionCatalogueResponseSchema.parse(res.body);
      expect(body.modules.flatMap((m) => m.keys).sort()).toEqual([...ALL_PERMISSIONS].sort());
    });

    it('needs iam.view', async () => {
      const s = await school();
      const teacher = await memberWithRole(s.tenantId, (await builtIn(s.tenantId, 'TEACHER')).id);
      expect((await get(teacher.cookie, '/iam/roles')).status).toBe(403);
      expect((await get(teacher.cookie, '/iam/permissions')).status).toBe(403);
      expect((await get('', '/iam/roles')).status).toBe(401);
    });

    it('does not show another school its roles', async () => {
      const a = await school();
      const b = await school();
      const custom = (
        await createRole(a.cookie, {
          name: 'Only A',
          permissions: ['students.view'],
          requiresTwoFactor: false,
        })
      ).body as { id: string };
      const listed = (await get(b.cookie, '/iam/roles')).body as { roles: { id: string }[] };
      expect(listed.roles.some((r) => r.id === custom.id)).toBe(false);
    });
  });

  describe('creating and cloning', () => {
    it('creates a custom role and audits it', async () => {
      const s = await school();
      const res = await createRole(s.cookie, {
        name: '  Front Desk ',
        description: 'Greets visitors',
        permissions: ['students.view', 'students.view', 'parents.view'],
        requiresTwoFactor: true,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        key: null,
        name: 'Front Desk',
        description: 'Greets visitors',
        requiresTwoFactor: true,
        memberCount: 0,
      });
      expect((res.body as { permissions: string[] }).permissions.sort()).toEqual([
        'parents.view',
        'students.view',
      ]);
      const rows = await auditRows(s.tenantId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'role.created',
        targetType: 'role',
        targetId: (res.body as { id: string }).id,
        actorUserId: s.userId,
      });
      expect(rows[0]?.after).toMatchObject({ name: 'Front Desk', requiresTwoFactor: true });
      expect((rows[0]?.after as { permissions: string[] }).permissions).toEqual([
        'parents.view',
        'students.view',
      ]);
    });

    it('clones Teacher when no permissions are given', async () => {
      const s = await school();
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      const res = await createRole(s.cookie, {
        name: 'Teacher copy',
        permissions: [],
        requiresTwoFactor: false,
        cloneFromRoleId: teacher.id,
      });
      expect(res.status).toBe(201);
      expect((res.body as { permissions: string[] }).permissions.sort()).toEqual(
        [...(BUILT_IN_ROLE_DEFAULTS.TEACHER.permissions as string[])].sort(),
      );
      expect((res.body as { key: unknown }).key).toBeNull();
    });

    it('lets the body permissions win over the source', async () => {
      const s = await school();
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      const res = await createRole(s.cookie, {
        name: 'Teacher lite',
        permissions: ['dashboard.view'],
        requiresTwoFactor: false,
        cloneFromRoleId: teacher.id,
      });
      expect(res.status).toBe(201);
      expect((res.body as { permissions: string[] }).permissions).toEqual(['dashboard.view']);
    });

    it('lets an owner clone Owner', async () => {
      const s = await school();
      const ownerRole = await builtIn(s.tenantId, 'OWNER');
      const res = await createRole(s.cookie, {
        name: 'Everything',
        permissions: [],
        requiresTwoFactor: true,
        cloneFromRoleId: ownerRole.id,
      });
      expect(res.status).toBe(201);
      expect((res.body as { permissions: string[] }).permissions).toHaveLength(
        ALL_PERMISSIONS.length,
      );
    });

    it('refuses an unknown permission key with 400', async () => {
      const s = await school();
      const res = await createRole(s.cookie, {
        name: 'Bad',
        permissions: ['students.fly'],
        requiresTwoFactor: false,
      });
      expect(res.status).toBe(400);
      expect(await auditRows(s.tenantId)).toHaveLength(0);
    });

    it('refuses a permission the actor lacks with 403 permission-denied', async () => {
      const s = await school();
      const manager = await managerWith(s.tenantId, ['students.view']);
      const res = await createRole(manager.cookie, {
        name: 'Sneaky',
        permissions: ['students.view', 'fees.approve'],
        requiresTwoFactor: false,
      });
      expect(res.status).toBe(403);
      expect((res.body as Problem).type).toBe('permission-denied');
      expect(await owner.role.count({ where: { tenantId: s.tenantId, name: 'Sneaky' } })).toBe(0);
      const ok = await createRole(manager.cookie, {
        name: 'Fine',
        permissions: ['students.view'],
        requiresTwoFactor: false,
      });
      expect(ok.status).toBe(201);
    });

    it('refuses a non-owner cloning Admin or Owner with 403', async () => {
      const s = await school();
      const manager = await managerWith(s.tenantId, ['students.view']);
      for (const key of ['ADMIN', 'OWNER']) {
        const source = await builtIn(s.tenantId, key);
        const res = await createRole(manager.cookie, {
          name: `Copy of ${key}`,
          permissions: [],
          requiresTwoFactor: false,
          cloneFromRoleId: source.id,
        });
        expect(res.status).toBe(403);
        expect((res.body as Problem).type).toBe('permission-denied');
      }
    });

    it('refuses a non-owner cloning Owner even when they hold every permission', async () => {
      const s = await school();
      const admin = await memberWithRole(s.tenantId, (await builtIn(s.tenantId, 'ADMIN')).id);
      const res = await createRole(admin.cookie, {
        name: 'Owner copy',
        permissions: [],
        requiresTwoFactor: false,
        cloneFromRoleId: (await builtIn(s.tenantId, 'OWNER')).id,
      });
      expect(res.status).toBe(403);
    });

    it('answers 404 for a clone source in another school', async () => {
      const a = await school();
      const b = await school();
      const res = await createRole(b.cookie, {
        name: 'Cross',
        permissions: [],
        requiresTwoFactor: false,
        cloneFromRoleId: (await builtIn(a.tenantId, 'TEACHER')).id,
      });
      expect(res.status).toBe(404);
    });

    it('refuses a duplicate name ignoring case with 409', async () => {
      const s = await school();
      const body = { name: 'Lab Assistant', permissions: [], requiresTwoFactor: false };
      expect((await createRole(s.cookie, body)).status).toBe(201);
      const dup = await createRole(s.cookie, { ...body, name: 'lab ASSISTANT' });
      expect(dup.status).toBe(409);
      expect((dup.body as Problem).errors?.[0]?.path).toBe('name');
      const builtInDup = await createRole(s.cookie, { ...body, name: 'teacher' });
      expect(builtInDup.status).toBe(409);
      expect(await auditRows(s.tenantId)).toHaveLength(1);
    });

    it('allows the same name in different schools', async () => {
      const a = await school();
      const b = await school();
      const body = { name: 'Shared Name', permissions: [], requiresTwoFactor: false };
      expect((await createRole(a.cookie, body)).status).toBe(201);
      expect((await createRole(b.cookie, body)).status).toBe(201);
    });
  });

  describe('editing', () => {
    it('refuses to rename a built-in role with 400', async () => {
      const s = await school();
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      const res = await send('put', s.cookie, `/iam/roles/${teacher.id}`, { name: 'Educator' });
      expect(res.status).toBe(400);
      expect(await auditRows(s.tenantId)).toHaveLength(0);
    });

    it('edits a custom role fully and audits one row', async () => {
      const s = await school();
      const created = (
        await createRole(s.cookie, {
          name: 'Clerk',
          permissions: ['students.view'],
          requiresTwoFactor: false,
        })
      ).body as { id: string };
      const res = await send('put', s.cookie, `/iam/roles/${created.id}`, {
        name: 'Senior Clerk',
        description: 'More',
        permissions: ['students.view', 'students.edit'],
        requiresTwoFactor: true,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: 'Senior Clerk',
        description: 'More',
        requiresTwoFactor: true,
      });
      const rows = await auditRows(s.tenantId, created.id);
      expect(rows.map((r) => r.action)).toEqual(['role.created', 'role.permissions_changed']);
    });

    it('records role.permissions_changed with the before and after lists', async () => {
      const s = await school();
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      const res = await send('put', s.cookie, `/iam/roles/${teacher.id}`, {
        permissions: ['dashboard.view', 'students.view', 'students.edit'],
      });
      expect(res.status).toBe(200);
      const rows = await auditRows(s.tenantId, teacher.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.action).toBe('role.permissions_changed');
      expect((rows[0]?.before as { permissions: string[] }).permissions.sort()).toEqual(
        [...(BUILT_IN_ROLE_DEFAULTS.TEACHER.permissions as string[])].sort(),
      );
      expect((rows[0]?.after as { permissions: string[] }).permissions).toEqual([
        'dashboard.view',
        'students.edit',
        'students.view',
      ]);
    });

    it('records role.updated when only other fields change, and nothing for a no-op', async () => {
      const s = await school();
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      const res = await send('put', s.cookie, `/iam/roles/${teacher.id}`, {
        description: 'Teaches',
        requiresTwoFactor: true,
      });
      expect(res.status).toBe(200);
      const rows = await auditRows(s.tenantId, teacher.id);
      expect(rows.map((r) => r.action)).toEqual(['role.updated']);
      expect(rows[0]?.before).toMatchObject({ requiresTwoFactor: false });
      expect(rows[0]?.after).toMatchObject({ description: 'Teaches', requiresTwoFactor: true });
      const again = await send('put', s.cookie, `/iam/roles/${teacher.id}`, {
        description: 'Teaches',
      });
      expect(again.status).toBe(200);
      expect(await auditRows(s.tenantId, teacher.id)).toHaveLength(1);
    });

    it("refuses to edit Owner's permissions, name or description with 400", async () => {
      const s = await school();
      const ownerRole = await builtIn(s.tenantId, 'OWNER');
      for (const body of [
        { permissions: ['students.view'] },
        { name: 'Boss' },
        { description: 'Changed' },
      ]) {
        const res = await send('put', s.cookie, `/iam/roles/${ownerRole.id}`, body);
        expect(res.status).toBe(400);
      }
      expect(await auditRows(s.tenantId)).toHaveLength(0);
    });

    it("lets only an owner edit Owner's requiresTwoFactor", async () => {
      const s = await school();
      const ownerRole = await builtIn(s.tenantId, 'OWNER');
      const admin = await memberWithRole(s.tenantId, (await builtIn(s.tenantId, 'ADMIN')).id);
      const denied = await send('put', admin.cookie, `/iam/roles/${ownerRole.id}`, {
        requiresTwoFactor: false,
      });
      expect(denied.status).toBe(403);
      const ok = await send('put', s.cookie, `/iam/roles/${ownerRole.id}`, {
        requiresTwoFactor: false,
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ requiresTwoFactor: false });
      const rows = await auditRows(s.tenantId, ownerRole.id);
      expect(rows.map((r) => r.action)).toEqual(['role.updated']);
    });

    it('refuses to add or remove a permission the actor lacks with 403', async () => {
      const s = await school();
      const manager = await managerWith(s.tenantId, ['students.view']);
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      // Adds fees.approve, which the manager lacks.
      const add = await send('put', manager.cookie, `/iam/roles/${teacher.id}`, {
        permissions: [...(BUILT_IN_ROLE_DEFAULTS.TEACHER.permissions as string[]), 'fees.approve'],
      });
      expect(add.status).toBe(403);
      expect((add.body as Problem).type).toBe('permission-denied');
      // Removes exams.edit, which the manager lacks.
      const remove = await send('put', manager.cookie, `/iam/roles/${teacher.id}`, {
        permissions: (BUILT_IN_ROLE_DEFAULTS.TEACHER.permissions as string[]).filter(
          (p) => p !== 'exams.edit',
        ),
      });
      expect(remove.status).toBe(403);
      expect(await auditRows(s.tenantId)).toHaveLength(0);
      // Changing only things the manager holds, with the rest left as is, is fine.
      const ok = await send('put', manager.cookie, `/iam/roles/${teacher.id}`, {
        permissions: (BUILT_IN_ROLE_DEFAULTS.TEACHER.permissions as string[]).filter(
          (p) => p !== 'students.view',
        ),
      });
      expect(ok.status).toBe(200);
    });

    it('refuses an unknown key and an empty body with 400', async () => {
      const s = await school();
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      expect(
        (await send('put', s.cookie, `/iam/roles/${teacher.id}`, { permissions: ['x.y'] })).status,
      ).toBe(400);
      expect((await send('put', s.cookie, `/iam/roles/${teacher.id}`, {})).status).toBe(400);
    });

    it('refuses renaming onto an existing name with 409', async () => {
      const s = await school();
      const mk = async (name: string) =>
        (await createRole(s.cookie, { name, permissions: [], requiresTwoFactor: false })).body as {
          id: string;
        };
      await mk('Alpha');
      const beta = await mk('Beta');
      const res = await send('put', s.cookie, `/iam/roles/${beta.id}`, { name: 'ALPHA' });
      expect(res.status).toBe(409);
      // Changing only the case of its own name is fine.
      const own = await send('put', s.cookie, `/iam/roles/${beta.id}`, { name: 'BETA' });
      expect(own.status).toBe(200);
    });

    it('restores the defaults with reset', async () => {
      const s = await school();
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      await send('put', s.cookie, `/iam/roles/${teacher.id}`, {
        permissions: ['dashboard.view'],
        description: 'Changed',
        requiresTwoFactor: true,
      });
      const res = await send('post', s.cookie, `/iam/roles/${teacher.id}/reset`);
      expect(res.status).toBe(200);
      const body = res.body as {
        permissions: string[];
        description: string;
        requiresTwoFactor: boolean;
      };
      expect(body.permissions.sort()).toEqual(
        [...(BUILT_IN_ROLE_DEFAULTS.TEACHER.permissions as string[])].sort(),
      );
      expect(body.description).toBe(BUILT_IN_ROLE_DEFAULTS.TEACHER.description);
      expect(body.requiresTwoFactor).toBe(false);
      const stored = await owner.rolePermission.findMany({ where: { roleId: teacher.id } });
      expect(stored.map((p) => p.permission).sort()).toEqual(
        [...(BUILT_IN_ROLE_DEFAULTS.TEACHER.permissions as string[])].sort(),
      );
      const rows = await auditRows(s.tenantId, teacher.id);
      expect(rows.map((r) => r.action)).toEqual([
        'role.permissions_changed',
        'role.permissions_changed',
      ]);
    });

    it('resets an all-permissions role to its full list', async () => {
      const s = await school();
      const admin = await builtIn(s.tenantId, 'ADMIN');
      await send('put', s.cookie, `/iam/roles/${admin.id}`, { permissions: ['dashboard.view'] });
      const res = await send('post', s.cookie, `/iam/roles/${admin.id}/reset`);
      expect(res.status).toBe(200);
      expect((res.body as { permissions: string[] }).permissions).toHaveLength(
        ALL_PERMISSIONS.length,
      );
    });

    it('refuses reset on a custom role with 400, and an escalating reset with 403', async () => {
      const s = await school();
      const custom = (
        await createRole(s.cookie, {
          name: 'Custom',
          permissions: [],
          requiresTwoFactor: false,
        })
      ).body as { id: string };
      expect((await send('post', s.cookie, `/iam/roles/${custom.id}/reset`)).status).toBe(400);

      const manager = await managerWith(s.tenantId, []);
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      await send('put', s.cookie, `/iam/roles/${teacher.id}`, { permissions: ['dashboard.view'] });
      const res = await send('post', manager.cookie, `/iam/roles/${teacher.id}/reset`);
      expect(res.status).toBe(403);
    });
  });

  describe('deleting', () => {
    it('refuses to delete a built-in role with 400', async () => {
      const s = await school();
      const teacher = await builtIn(s.tenantId, 'TEACHER');
      expect((await send('delete', s.cookie, `/iam/roles/${teacher.id}`)).status).toBe(400);
      expect(await owner.role.count({ where: { id: teacher.id } })).toBe(1);
    });

    it('refuses to delete a role that is assigned with 409', async () => {
      const s = await school();
      const custom = (
        await createRole(s.cookie, {
          name: 'Assigned',
          permissions: ['students.view'],
          requiresTwoFactor: false,
        })
      ).body as { id: string };
      await memberWithRole(s.tenantId, custom.id);
      const res = await send('delete', s.cookie, `/iam/roles/${custom.id}`);
      expect(res.status).toBe(409);
      expect((res.body as Problem).type).toBe('role-in-use');
      expect(await owner.role.count({ where: { id: custom.id } })).toBe(1);
    });

    it('deletes an unassigned custom role with 204 and audits it', async () => {
      const s = await school();
      const custom = (
        await createRole(s.cookie, {
          name: 'Temporary',
          permissions: ['students.view'],
          requiresTwoFactor: false,
        })
      ).body as { id: string };
      const res = await send('delete', s.cookie, `/iam/roles/${custom.id}`);
      expect(res.status).toBe(204);
      expect(await owner.role.count({ where: { id: custom.id } })).toBe(0);
      expect(await owner.rolePermission.count({ where: { roleId: custom.id } })).toBe(0);
      const rows = await auditRows(s.tenantId, custom.id);
      expect(rows.map((r) => r.action)).toEqual(['role.created', 'role.deleted']);
      expect(rows[1]?.before).toMatchObject({ name: 'Temporary', permissions: ['students.view'] });
      expect(rows[1]?.after).toBeNull();
    });
  });

  describe('permissions and isolation', () => {
    it('lets a viewer list but not change', async () => {
      const s = await school();
      const viewer = await memberWithRole(
        s.tenantId,
        (
          await owner.role.create({
            data: {
              tenantId: s.tenantId,
              name: 'Viewer',
              permissions: { create: [{ permission: 'iam.view' }] },
            },
          })
        ).id,
      );
      expect((await get(viewer.cookie, '/iam/roles')).status).toBe(200);
      const res = await createRole(viewer.cookie, {
        name: 'Nope',
        permissions: [],
        requiresTwoFactor: false,
      });
      expect(res.status).toBe(403);
    });

    it("answers 404 when school B touches school A's role", async () => {
      const a = await school();
      const b = await school();
      const teacherA = await builtIn(a.tenantId, 'TEACHER');
      const customA = (
        await createRole(a.cookie, {
          name: 'A only',
          permissions: [],
          requiresTwoFactor: false,
        })
      ).body as { id: string };
      for (const id of [teacherA.id, customA.id, randomUUID()]) {
        expect((await send('put', b.cookie, `/iam/roles/${id}`, { description: 'x' })).status).toBe(
          404,
        );
        expect((await send('post', b.cookie, `/iam/roles/${id}/reset`)).status).toBe(404);
        expect((await send('delete', b.cookie, `/iam/roles/${id}`)).status).toBe(404);
      }
      expect(await owner.role.count({ where: { id: customA.id } })).toBe(1);
      expect(await auditRows(b.tenantId)).toHaveLength(0);
    });

    it('answers 404 for a malformed role id', async () => {
      const s = await school();
      expect((await send('delete', s.cookie, '/iam/roles/not-a-uuid')).status).toBe(404);
    });
  });

  describe('rate limit', () => {
    it('answers 429 on the 61st mutation in an hour', async () => {
      const s = await school();
      await redis.client.set(`iam:mutations:${s.userId}`, 59, 'EX', 3600);
      const body = (name: string) => ({ name, permissions: [], requiresTwoFactor: false });
      expect((await createRole(s.cookie, body('Sixty'))).status).toBe(201);
      const res = await createRole(s.cookie, body('Sixty one'));
      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
      expect(await owner.role.count({ where: { tenantId: s.tenantId, name: 'Sixty one' } })).toBe(
        0,
      );
      // Reading is not limited.
      expect((await get(s.cookie, '/iam/roles')).status).toBe(200);
    });

    it('counts per user, not per school', async () => {
      const s = await school();
      await redis.client.set(`iam:mutations:${s.userId}`, 60, 'EX', 3600);
      const other = await managerWith(s.tenantId, ['students.view']);
      const res = await createRole(other.cookie, {
        name: 'Other user',
        permissions: ['students.view'],
        requiresTwoFactor: false,
      });
      expect(res.status).toBe(201);
    });
  });
});
