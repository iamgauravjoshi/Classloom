import type { INestApplication } from '@nestjs/common';

import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import { AuthCleanupProcessor } from '../../src/modules/auth/auth-cleanup.processor';
import { sha256 } from '../../src/modules/auth/crypto';
import { KnownDeviceService } from '../../src/modules/auth/known-device.service';
import { SessionService } from '../../src/modules/auth/session.service';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';
import { seedSchool } from './helpers';

const DAY = 86_400_000;
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

describe('known devices', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let owner: PrismaClient;
  let devices: KnownDeviceService;
  let sessions: SessionService;
  let cleanup: AuthCleanupProcessor;
  let counter = 0;

  async function school() {
    counter += 1;
    return seedSchool(owner, {
      code: `DEV${counter}`,
      email: `owner${counter}@dev.in`,
      mobile: `+9197000000${String(counter).padStart(2, '0')}`,
      password: 'correct horse battery',
    });
  }

  beforeAll(async () => {
    infra = await startTestInfra();
    app = await createApp({ ...infra.env, DATABASE_MIGRATION_URL: undefined }, { logger: false });
    await app.init();
    owner = ownerPrisma(infra.env);
    devices = app.get(KnownDeviceService, { strict: false });
    sessions = app.get(SessionService, { strict: false });
    cleanup = app.get(AuthCleanupProcessor, { strict: false });
    // Let the boot-time clean-up run finish so it cannot delete rows these tests seed.
    await new Promise((r) => setTimeout(r, 1500));
  }, 120_000);

  afterAll(async () => {
    await owner?.$disconnect();
    await app?.close();
    await infra?.stop();
  });

  it('records a first sign-in as new with the parsed label, storing only the hash', async () => {
    const { userId } = await school();
    const first = await devices.recordSignIn(userId, 'token-a', CHROME, { trust: false });
    expect(first.isNew).toBe(true);
    expect(first.device.label).toBe('Chrome on Windows');
    expect(first.device.trustedUntil).toBeNull();
    expect(Buffer.from(first.device.deviceHash)).toEqual(sha256('token-a'));
    expect(await devices.find(userId, 'token-a')).not.toBeNull();
    expect(await devices.find(userId, 'other')).toBeNull();
  });

  it('a second sign-in is not new and moves last_seen_at', async () => {
    const { userId } = await school();
    const t0 = new Date('2026-01-01T00:00:00Z');
    const t1 = new Date('2026-01-02T00:00:00Z');
    const first = await devices.recordSignIn(userId, 'tok', CHROME, { trust: false }, t0);
    const second = await devices.recordSignIn(userId, 'tok', CHROME, { trust: false }, t1);
    expect(second.isNew).toBe(false);
    expect(second.device.id).toBe(first.device.id);
    expect(second.device.firstSeenAt).toEqual(t0);
    expect(second.device.lastSeenAt).toEqual(t1);
  });

  it('trust sets trusted_until to now + 30 days and expires', async () => {
    const { userId } = await school();
    const now = new Date('2026-03-01T00:00:00Z');
    const { device } = await devices.recordSignIn(userId, 'tok', CHROME, { trust: true }, now);
    expect(device.trustedUntil?.getTime()).toBe(now.getTime() + 30 * DAY);
    expect(devices.isTrusted(device, new Date(now.getTime() + 29 * DAY))).toBe(true);
    expect(devices.isTrusted(device, new Date(now.getTime() + 31 * DAY))).toBe(false);
    expect(devices.isTrusted(null, now)).toBe(false);
  });

  it("untrust refuses another user's device", async () => {
    const a = await school();
    const b = await school();
    const { device } = await devices.recordSignIn(a.userId, 'tok', CHROME, { trust: true });
    expect(await devices.untrust(b.userId, device.id)).toBe(false);
    expect((await devices.find(a.userId, 'tok'))?.trustedUntil).not.toBeNull();
    expect(await devices.untrust(a.userId, device.id)).toBe(true);
    expect((await devices.find(a.userId, 'tok'))?.trustedUntil).toBeNull();
  });

  it("changePassword clears every trusted_until of the user, and only that user's", async () => {
    const a = await school();
    const b = await school();
    await devices.recordSignIn(a.userId, 'one', CHROME, { trust: true });
    await devices.recordSignIn(a.userId, 'two', CHROME, { trust: true });
    await devices.recordSignIn(b.userId, 'one', CHROME, { trust: true });
    await sessions.changePassword(a.userId, { passwordHash: 'x', reason: 'PASSWORD_CHANGED' });
    const trusted = (userId: string) =>
      owner.knownDevice.count({ where: { userId, trustedUntil: { not: null } } });
    expect(await trusted(a.userId)).toBe(0);
    expect(await trusted(b.userId)).toBe(1);
  });

  it('clean-up deletes devices not seen for 366 days and keeps 364', async () => {
    const { userId } = await school();
    const now = new Date();
    const at = (days: number) => new Date(now.getTime() - days * DAY);
    await devices.recordSignIn(userId, 'old', CHROME, { trust: false }, at(366));
    const recent = await devices.recordSignIn(userId, 'recent', CHROME, { trust: false }, at(364));
    const result = await cleanup.purge(now);
    expect(result.devices).toBeGreaterThanOrEqual(1);
    const left = (await owner.knownDevice.findMany({ where: { userId } })).map((d) => d.id);
    expect(left).toEqual([recent.device.id]);
  });
});
