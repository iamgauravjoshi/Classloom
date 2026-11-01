import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Command } from 'commander';

import { CliModule } from '../../src/cli/cli.module';
import { buildCli } from '../../src/cli/schools.commands';
import { registerUserCommands } from '../../src/cli/users.commands';
import { PlatformPrismaService } from '../../src/core/prisma/platform-prisma.service';
import { createApp } from '../../src/main';
import { sha256 } from '../../src/modules/auth/crypto';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normaliseRecoveryCode,
} from '../../src/modules/auth/recovery-codes';
import { encryptSecret } from '../../src/modules/auth/secret-box';
import { generateTotpSecret } from '../../src/modules/auth/totp';
import { startTestInfra, type TestInfra } from '../setup-containers';
import { seedSchool } from './helpers';

const SUBJECT = 'Two-step sign-in was turned off';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface MailpitSummary {
  Subject: string;
}

describe('users:disable-2fa', () => {
  let infra: TestInfra;
  let ctx: INestApplicationContext;
  let http: INestApplication;
  let platform: PlatformPrismaService;
  let lines: string[];
  let counter = 0;

  const run = (...args: string[]) => {
    lines = [];
    const out = (line: string) => lines.push(line);
    const program: Command = buildCli(ctx, out);
    registerUserCommands(program, ctx, out);
    return program.parseAsync(args, { from: 'user' });
  };

  async function twoStepUser() {
    counter += 1;
    const email = `person${counter}@cli.test`;
    const ids = await seedSchool(platform, { code: `CLU${counter}`, email });
    await platform.user.update({
      where: { id: ids.userId },
      data: {
        totpSecretEnc: new Uint8Array(
          encryptSecret(infra.env.TOTP_ENCRYPTION_KEY, generateTotpSecret()),
        ),
        totpEnabledAt: new Date(),
        totpLastStep: 5n,
      },
    });
    await platform.recoveryCode.createMany({
      data: generateRecoveryCodes().map((c) => ({
        userId: ids.userId,
        codeHash: hashRecoveryCode(infra.env.AUTH_SECRET, normaliseRecoveryCode(c)),
      })),
    });
    await platform.knownDevice.create({
      data: {
        userId: ids.userId,
        deviceHash: new Uint8Array(sha256(`device-${counter}`)),
        label: 'Chrome on Windows',
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        trustedUntil: new Date(Date.now() + 86_400_000),
      },
    });
    for (let i = 0; i < 2; i += 1) {
      await platform.session.create({
        data: {
          tokenHash: new Uint8Array(sha256(`session-${counter}-${i}`)),
          userId: ids.userId,
          tenantId: ids.tenantId,
          membershipId: ids.membershipId,
          remember: false,
          authenticatedAt: new Date(),
          lastSeenAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
          idleExpiresAt: new Date(Date.now() + 86_400_000),
        },
      });
    }
    return { email, ...ids };
  }

  async function mailsTo(address: string): Promise<MailpitSummary[]> {
    const res = await fetch(
      `${infra.mailpitApiUrl}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    return ((await res.json()) as { messages: MailpitSummary[] }).messages;
  }

  async function expectTurnedOffMail(address: string) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && (await mailsTo(address)).length < 1) await sleep(200);
    await sleep(500);
    expect((await mailsTo(address)).map((m) => m.Subject)).toEqual([SUBJECT]);
  }

  beforeAll(async () => {
    infra = await startTestInfra({ mailpit: true });
    ctx = await NestFactory.createApplicationContext(CliModule.forRoot(infra.env), {
      logger: false,
    });
    platform = ctx.get(PlatformPrismaService);
    // The API's worker delivers what the CLI queues.
    http = await createApp(infra.env, { logger: false });
    await http.init();
  }, 120_000);

  afterAll(async () => {
    await http?.close();
    await ctx?.close();
    await infra?.stop();
  });

  it('turns two-step off, clears codes and trust, ends sessions, records it, emails and logs', async () => {
    const u = await twoStepUser();
    await run('users:disable-2fa', u.email.toUpperCase(), '--reason', 'Lost phone, ticket 42');

    const row = await platform.user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(row).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null });
    expect(await platform.recoveryCode.count({ where: { userId: u.userId } })).toBe(0);
    expect(
      await platform.knownDevice.count({
        where: { userId: u.userId, trustedUntil: { not: null } },
      }),
    ).toBe(0);
    const sessions = await platform.session.findMany({ where: { userId: u.userId } });
    expect(sessions).toHaveLength(2);
    for (const s of sessions) {
      expect(s.revokedAt).not.toBeNull();
      expect(s.revokedReason).toBe('TWO_FACTOR_DISABLED');
    }
    expect(
      await platform.authEvent.count({ where: { userId: u.userId, type: 'TWO_FACTOR_DISABLED' } }),
    ).toBe(1);

    expect(JSON.parse(lines[0] as string)).toMatchObject({
      action: 'disable-2fa',
      email: u.email,
      reason: 'Lost phone, ticket 42',
    });
    expect((JSON.parse(lines[0] as string) as { by: string }).by).toEqual(expect.any(String));
    await expectTurnedOffMail(u.email);
  });

  it('requires a reason', async () => {
    const u = await twoStepUser();
    await expect(run('users:disable-2fa', u.email)).rejects.toThrow(/reason/);
    const row = await platform.user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(row.totpEnabledAt).not.toBeNull();
  });

  it('exits non-zero for an unknown email', async () => {
    await expect(run('users:disable-2fa', 'nobody@cli.test', '--reason', 'x')).rejects.toThrow(
      'User nobody@cli.test not found',
    );
  });

  it('says so when two-step is already off and changes nothing', async () => {
    counter += 1;
    const email = `off${counter}@cli.test`;
    const ids = await seedSchool(platform, { code: `CLO${counter}`, email });
    await expect(run('users:disable-2fa', email, '--reason', 'x')).rejects.toThrow(/not turned on/);
    expect(
      await platform.authEvent.count({
        where: { userId: ids.userId, type: 'TWO_FACTOR_DISABLED' },
      }),
    ).toBe(0);
  });
});
