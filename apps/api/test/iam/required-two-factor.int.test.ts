import { authSessionSchema, twoFactorSetupSchema } from '@classloom/contracts';
import type { INestApplication } from '@nestjs/common';
import { generateSync } from 'otplib';
import request from 'supertest';
import type { App } from 'supertest/types';

import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import { SessionService } from '../../src/modules/auth/session.service';
import { addMember, seedSchool } from '../auth/helpers';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';

const WEB_ORIGIN = 'http://localhost:3000';
const COOKIE = 'cl_session';

const codeAt = (secret: string) =>
  generateSync({
    secret,
    strategy: 'hotp',
    counter: Math.floor(Date.now() / 30_000),
    digits: 6,
    algorithm: 'sha1',
  });

describe('required two-step sign-in', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let sessions: SessionService;
  let counter = 0;

  const get = (cookie: string, path: string) => request(server).get(path).set('Cookie', cookie);
  const post = (cookie: string, path: string, body: object = {}) =>
    request(server).post(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN).send(body);

  const setRequired = (roleId: string, requiresTwoFactor: boolean) =>
    owner.role.update({ where: { id: roleId }, data: { requiresTwoFactor } });

  /** A school; its owner never requires two-step by default in tests (see `seedSchool`). */
  async function school() {
    counter += 1;
    const ids = await seedSchool(owner, { code: `RTF${counter}`, email: `o${counter}@rtf.test` });
    const ownerRole = await owner.role.findFirstOrThrow({
      where: { tenantId: ids.tenantId, key: 'OWNER' },
    });
    return { ...ids, ownerRole };
  }

  /** A Teacher without two-step, with a session. The Teacher role does not require it yet. */
  async function teacher() {
    const s = await school();
    counter += 1;
    const user = await owner.user.create({
      data: {
        email: `t${counter}@rtf.test`,
        name: `Teacher ${counter}`,
        emailVerifiedAt: new Date(),
      },
    });
    const membership = await addMember(owner, s.tenantId, user.id, 'TEACHER');
    const role = await owner.role.findFirstOrThrow({
      where: { tenantId: s.tenantId, key: 'TEACHER' },
    });
    await setRequired(role.id, false);
    const { token, session } = await sessions.create({
      tenantId: s.tenantId,
      userId: user.id,
      membershipId: membership.id,
      remember: false,
    });
    return {
      ...s,
      userId: user.id,
      membershipId: membership.id,
      role,
      sessionId: session.id,
      cookie: `${COOKIE}=${token}`,
    };
  }

  const authSession = async (cookie: string) =>
    authSessionSchema.parse((await get(cookie, '/auth/session')).body);

  beforeAll(async () => {
    infra = await startTestInfra();
    app = await createApp(infra.env, { logger: false });
    await app.init();
    server = app.getHttpServer() as App;
    owner = ownerPrisma(infra.env);
    sessions = app.get(SessionService, { strict: false });
  }, 120_000);

  afterAll(async () => {
    await owner?.$disconnect();
    await app?.close();
    await infra?.stop();
  });

  describe('a member whose role now requires it', () => {
    it('is limited to the setup routes on the very next request', async () => {
      const t = await teacher();
      expect((await get(t.cookie, '/me/sessions')).status).toBe(200);
      expect((await authSession(t.cookie)).twoFactorSetupRequired).toBe(false);

      await setRequired(t.role.id, true);

      const blocked = await get(t.cookie, '/me/sessions');
      expect(blocked.status).toBe(403);
      expect(blocked.body).toMatchObject({ type: 'two-factor-setup-required' });
      expect((await get(t.cookie, '/iam/roles')).body).toMatchObject({
        type: 'two-factor-setup-required',
      });
      expect((await post(t.cookie, '/me/sessions/revoke-others')).status).toBe(403);
    });

    it('still reaches the setup routes and shows the flag', async () => {
      const t = await teacher();
      await setRequired(t.role.id, true);

      expect((await authSession(t.cookie)).twoFactorSetupRequired).toBe(true);
      expect((await get(t.cookie, '/me')).status).toBe(200);
      const status = await get(t.cookie, '/me/two-factor');
      expect(status.status).toBe(200);
      expect(status.body).toMatchObject({ enabled: false });
      expect((await post(t.cookie, '/me/two-factor/setup')).status).toBe(200);
      // A wrong code is refused by the route itself, not by the guard.
      expect((await post(t.cookie, '/me/two-factor/enable', { code: '000000' })).status).toBe(400);
      // Other two-step routes stay closed.
      expect(
        (await post(t.cookie, '/me/two-factor/recovery-codes', { code: '000000' })).status,
      ).toBe(403);
    });

    it('can sign out', async () => {
      const t = await teacher();
      await setRequired(t.role.id, true);
      expect((await post(t.cookie, '/auth/sign-out')).status).toBe(204);
      expect((await get(t.cookie, '/me')).status).toBe(401);
    });

    it('is cleared at once when setup and enable finish on the same session', async () => {
      const t = await teacher();
      await setRequired(t.role.id, true);
      await owner.session.update({
        where: { id: t.sessionId },
        data: { twoFactorSetupRequired: true },
      });

      const setup = twoFactorSetupSchema.parse((await post(t.cookie, '/me/two-factor/setup')).body);
      const enabled = await post(t.cookie, '/me/two-factor/enable', { code: codeAt(setup.secret) });
      expect(enabled.status).toBe(200);

      expect((await get(t.cookie, '/me/sessions')).status).toBe(200);
      expect((await authSession(t.cookie)).twoFactorSetupRequired).toBe(false);
      const row = await owner.session.findUniqueOrThrow({ where: { id: t.sessionId } });
      expect(row.twoFactorSetupRequired).toBe(false);
    });

    it('is cleared on the next request when the requirement is turned off', async () => {
      const t = await teacher();
      await setRequired(t.role.id, true);
      expect((await get(t.cookie, '/me/sessions')).status).toBe(403);

      await setRequired(t.role.id, false);

      expect((await get(t.cookie, '/me/sessions')).status).toBe(200);
      expect((await authSession(t.cookie)).twoFactorSetupRequired).toBe(false);
    });

    it('is not limited when it already has two-step on', async () => {
      const t = await teacher();
      await owner.user.update({
        where: { id: t.userId },
        data: { totpEnabledAt: new Date() },
      });
      await setRequired(t.role.id, true);
      expect((await get(t.cookie, '/me/sessions')).status).toBe(200);
    });
  });

  describe('an owner without two-step', () => {
    it('follows the same flow', async () => {
      const s = await school();
      const { token } = await sessions.create({
        tenantId: s.tenantId,
        userId: s.userId,
        membershipId: s.membershipId,
        remember: false,
      });
      const cookie = `${COOKIE}=${token}`;
      expect((await get(cookie, '/me/sessions')).status).toBe(200);

      await setRequired(s.ownerRole.id, true);
      expect((await get(cookie, '/me/sessions')).body).toMatchObject({
        type: 'two-factor-setup-required',
      });
      expect((await authSession(cookie)).twoFactorSetupRequired).toBe(true);

      const setup = twoFactorSetupSchema.parse((await post(cookie, '/me/two-factor/setup')).body);
      expect(
        (await post(cookie, '/me/two-factor/enable', { code: codeAt(setup.secret) })).status,
      ).toBe(200);
      expect((await get(cookie, '/me/sessions')).status).toBe(200);
    });
  });

  describe('the stored flag', () => {
    it('is set on a new sign-in for a member who must set up two-step', async () => {
      const t = await teacher();
      await setRequired(t.role.id, true);
      const { session } = await sessions.create({
        tenantId: t.tenantId,
        userId: t.userId,
        membershipId: t.membershipId,
        remember: false,
      });
      expect(session.twoFactorSetupRequired).toBe(true);
      const stored = await owner.session.findUniqueOrThrow({ where: { id: session.id } });
      expect(stored.twoFactorSetupRequired).toBe(true);
    });

    it('is not set when the role does not require it, or the member has two-step', async () => {
      const t = await teacher();
      const plain = await sessions.create({
        tenantId: t.tenantId,
        userId: t.userId,
        membershipId: t.membershipId,
        remember: false,
      });
      expect(plain.session.twoFactorSetupRequired).toBe(false);

      await setRequired(t.role.id, true);
      await owner.user.update({ where: { id: t.userId }, data: { totpEnabledAt: new Date() } });
      const withTwoFactor = await sessions.create({
        tenantId: t.tenantId,
        userId: t.userId,
        membershipId: t.membershipId,
        remember: false,
      });
      expect(withTwoFactor.session.twoFactorSetupRequired).toBe(false);
    });
  });
});
