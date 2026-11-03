import { randomUUID } from 'node:crypto';

import { loginActivityPageSchema, myDevicesSchema, mySessionsSchema } from '@classloom/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import { randomToken, sha256 } from '../../src/modules/auth/crypto';
import { SessionService } from '../../src/modules/auth/session.service';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';
import { addMember, seedSchool } from './helpers';

const WEB_ORIGIN = 'http://localhost:3000';
const DAY = 86_400_000;
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

describe('sessions, devices and sign-in history', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let sessions: SessionService;
  let counter = 0;

  /** A user in two schools, each with a live session; `a` is the session the requests use. */
  async function account() {
    counter += 1;
    const one = await seedSchool(owner, { code: `SLA${counter}`, email: `u${counter}@lists.test` });
    const two = await seedSchool(owner, { code: `SLB${counter}`, email: `x${counter}@lists.test` });
    const membershipTwo = await addMember(owner, two.tenantId, one.userId);
    const first = await sessions.create({ ...one, remember: true, userAgent: CHROME });
    const second = await sessions.create({
      tenantId: two.tenantId,
      userId: one.userId,
      membershipId: membershipTwo.id,
      remember: false,
      userAgent: CHROME,
    });
    return {
      userId: one.userId,
      tenantId: one.tenantId,
      codeOne: `SLA${counter}`,
      codeTwo: `SLB${counter}`,
      current: first.session.id,
      other: second.session.id,
      cookie: `cl_session=${first.token}`,
      otherCookie: `cl_session=${second.token}`,
    };
  }
  type Account = Awaited<ReturnType<typeof account>>;

  const get = (a: Account, path: string, extraCookie = '') =>
    request(server)
      .get(path)
      .set('Cookie', extraCookie ? `${a.cookie}; ${extraCookie}` : a.cookie);
  const post = (a: Account, path: string) =>
    request(server).post(path).set('Cookie', a.cookie).set('Origin', WEB_ORIGIN).send({});

  const eventTypes = async (userId: string) =>
    (await owner.authEvent.findMany({ where: { userId } })).map((e) => e.type);

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

  describe('sessions', () => {
    it('is 401 signed out', async () => {
      expect((await request(server).get('/me/sessions')).status).toBe(401);
    });

    it('lists only live sessions across both schools, marking the current one', async () => {
      const a = await account();
      const stranger = await account();
      const dead = await sessions.create({
        userId: a.userId,
        tenantId: a.tenantId,
        membershipId: (await owner.membership.findFirstOrThrow({ where: { userId: a.userId } })).id,
        remember: true,
      });
      await sessions.revoke(dead.session.id, 'SIGNED_OUT');

      const res = await get(a, '/me/sessions');
      expect(res.status).toBe(200);
      const body = mySessionsSchema.parse(res.body);
      expect(body.sessions.map((s) => s.id).sort()).toEqual([a.current, a.other].sort());
      expect(body.sessions.find((s) => s.id === a.current)).toMatchObject({
        current: true,
        school: { code: a.codeOne, name: `School ${a.codeOne}` },
        device: 'Chrome on Windows',
        remember: true,
      });
      expect(body.sessions.find((s) => s.id === a.other)).toMatchObject({
        current: false,
        school: { code: a.codeTwo, name: `School ${a.codeTwo}` },
        remember: false,
      });
      expect(body.sessions.some((s) => s.id === stranger.current)).toBe(false);
    });

    it('ends another session: 204, its cookie is then refused, SESSION_REVOKED is recorded', async () => {
      const a = await account();
      expect((await post(a, `/me/sessions/${a.other}/revoke`)).status).toBe(204);
      expect((await request(server).get('/auth/session').set('Cookie', a.otherCookie)).status).toBe(
        401,
      );
      expect((await request(server).get('/auth/session').set('Cookie', a.cookie)).status).toBe(200);
      expect(await owner.session.findUnique({ where: { id: a.other } })).toMatchObject({
        revokedReason: 'REVOKED_BY_USER',
      });
      expect(await eventTypes(a.userId)).toContain('SESSION_REVOKED');
      // already ended: no longer a live session
      expect((await post(a, `/me/sessions/${a.other}/revoke`)).status).toBe(404);
    });

    it('refuses to end the current session with 400', async () => {
      const a = await account();
      const res = await post(a, `/me/sessions/${a.current}/revoke`);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ title: 'Use sign out to end this session.' });
      expect((await request(server).get('/auth/session').set('Cookie', a.cookie)).status).toBe(200);
    });

    it("answers 404 for another user's session and for a malformed id", async () => {
      const a = await account();
      const stranger = await account();
      expect((await post(a, `/me/sessions/${stranger.current}/revoke`)).status).toBe(404);
      expect((await post(a, '/me/sessions/not-a-uuid/revoke')).status).toBe(404);
      expect(
        (await request(server).get('/auth/session').set('Cookie', stranger.cookie)).status,
      ).toBe(200);
    });

    it('revoke-others leaves only the current session', async () => {
      const a = await account();
      expect((await post(a, '/me/sessions/revoke-others')).status).toBe(204);
      const body = mySessionsSchema.parse((await get(a, '/me/sessions')).body);
      expect(body.sessions.map((s) => s.id)).toEqual([a.current]);
      expect((await request(server).get('/auth/session').set('Cookie', a.otherCookie)).status).toBe(
        401,
      );
    });
  });

  describe('devices', () => {
    async function device(userId: string, opts: { trusted?: boolean } = {}) {
      const token = randomToken();
      const row = await owner.knownDevice.create({
        data: {
          userId,
          deviceHash: new Uint8Array(sha256(token)),
          label: 'Chrome on Windows',
          firstSeenAt: new Date(Date.now() - 2 * DAY),
          lastSeenAt: new Date(),
          trustedUntil: opts.trusted ? new Date(Date.now() + 10 * DAY) : null,
        },
      });
      return { token, id: row.id };
    }

    it('lists the devices and marks the one in the device cookie as current', async () => {
      const a = await account();
      const mine = await device(a.userId, { trusted: true });
      const other = await device(a.userId);
      const stranger = await account();
      await device(stranger.userId);

      const body = myDevicesSchema.parse(
        (await get(a, '/me/devices', `cl_device=${mine.token}`)).body,
      );
      expect(body.devices.map((d) => d.id).sort()).toEqual([mine.id, other.id].sort());
      expect(body.devices.find((d) => d.id === mine.id)).toMatchObject({
        current: true,
        label: 'Chrome on Windows',
      });
      expect(body.devices.find((d) => d.id === mine.id)?.trustedUntil).not.toBeNull();
      expect(body.devices.find((d) => d.id === other.id)).toMatchObject({
        current: false,
        trustedUntil: null,
      });

      const noCookie = myDevicesSchema.parse((await get(a, '/me/devices')).body);
      expect(noCookie.devices.every((d) => !d.current)).toBe(true);
    });

    it('untrusts a device: 204, trust cleared, DEVICE_UNTRUSTED recorded once', async () => {
      const a = await account();
      const d = await device(a.userId, { trusted: true });
      expect((await post(a, `/me/devices/${d.id}/untrust`)).status).toBe(204);
      expect(
        (await owner.knownDevice.findUniqueOrThrow({ where: { id: d.id } })).trustedUntil,
      ).toBe(null);
      expect((await eventTypes(a.userId)).filter((t) => t === 'DEVICE_UNTRUSTED')).toHaveLength(1);
    });

    it("answers 404 for another user's device and for an unknown or malformed id", async () => {
      const a = await account();
      const stranger = await account();
      const theirs = await device(stranger.userId, { trusted: true });
      expect((await post(a, `/me/devices/${theirs.id}/untrust`)).status).toBe(404);
      expect((await post(a, `/me/devices/${randomUUID()}/untrust`)).status).toBe(404);
      expect((await post(a, '/me/devices/nope/untrust')).status).toBe(404);
      expect(
        (await owner.knownDevice.findUniqueOrThrow({ where: { id: theirs.id } })).trustedUntil,
      ).not.toBeNull();
    });
  });

  describe('login activity', () => {
    it('pages 20 at a time, newest first, with a working cursor and nothing older than 365 days', async () => {
      const a = await account();
      const stranger = await account();
      const now = Date.now();
      await owner.authEvent.createMany({
        data: Array.from({ length: 25 }, (_, i) => ({
          type: 'SIGN_IN_SUCCEEDED' as const,
          method: 'PASSWORD' as const,
          userId: a.userId,
          tenantId: a.tenantId,
          ip: '203.0.113.7',
          userAgent: CHROME,
          createdAt: new Date(now - (i + 1) * 60_000),
        })),
      });
      await owner.authEvent.create({
        data: {
          type: 'SIGN_IN_FAILED',
          userId: a.userId,
          createdAt: new Date(now - 366 * DAY),
        },
      });
      await owner.authEvent.create({
        data: { type: 'SIGN_IN_FAILED', userId: stranger.userId, createdAt: new Date(now - 1000) },
      });

      const first = loginActivityPageSchema.parse((await get(a, '/me/login-activity')).body);
      expect(first.events).toHaveLength(20);
      expect(first.nextCursor).not.toBeNull();
      expect(first.events[0]).toMatchObject({
        type: 'SIGN_IN_SUCCEEDED',
        method: 'PASSWORD',
        device: 'Chrome on Windows',
        ip: '203.0.113.7',
        school: { code: a.codeOne, name: `School ${a.codeOne}` },
      });
      const times = first.events.map((e) => Date.parse(e.at));
      expect([...times].sort((x, y) => y - x)).toEqual(times);

      const second = loginActivityPageSchema.parse(
        (
          await get(
            a,
            `/me/login-activity?cursor=${encodeURIComponent(first.nextCursor as string)}`,
          )
        ).body,
      );
      expect(second.nextCursor).toBeNull();
      const all = [...first.events, ...second.events];
      // 25 seeded rows, plus the session creation events none; the 366-day-old and the stranger's are absent
      const seeded = all.filter((e) => e.type === 'SIGN_IN_SUCCEEDED' && e.ip === '203.0.113.7');
      expect(seeded).toHaveLength(25);
      expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
      expect(all.some((e) => e.type === 'SIGN_IN_FAILED')).toBe(false);
    });

    it('does not skip or repeat rows that share a millisecond', async () => {
      const a = await account();
      const at = new Date(Date.now() - 5 * 60_000);
      await owner.authEvent.createMany({
        data: Array.from({ length: 45 }, () => ({
          type: 'CODE_REQUESTED' as const,
          userId: a.userId,
          createdAt: at,
        })),
      });
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const path: string = cursor
          ? `/me/login-activity?cursor=${encodeURIComponent(cursor)}`
          : '/me/login-activity';
        const page = loginActivityPageSchema.parse((await get(a, path)).body);
        ids.push(...page.events.map((e) => e.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(ids).toHaveLength(45);
      expect(new Set(ids).size).toBe(45);
    });

    it('rejects a malformed cursor with 400', async () => {
      const a = await account();
      expect((await get(a, '/me/login-activity?cursor=garbage')).status).toBe(400);
    });
  });

  describe('rate limit', () => {
    it('allows 30 changes an hour and answers the 31st with 429', async () => {
      const a = await account();
      for (let i = 0; i < 30; i += 1) {
        expect((await post(a, `/me/devices/${randomUUID()}/untrust`)).status).toBe(404);
      }
      const res = await post(a, `/me/devices/${randomUUID()}/untrust`);
      expect(res.status).toBe(429);
      const other = await account();
      expect((await post(other, `/me/devices/${randomUUID()}/untrust`)).status).toBe(404);
    });
  });
});
