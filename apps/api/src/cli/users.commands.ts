import os from 'node:os';

import type { INestApplicationContext } from '@nestjs/common';
import type { Command } from 'commander';

import { ENV } from '../core/config/config.module';
import type { Env } from '../core/config/env.schema';
import { EmailService } from '../core/email/email.service';
import { twoFactorChangedEmail } from '../core/email/templates/two-factor-changed';
import { PlatformPrismaService } from '../core/prisma/platform-prisma.service';
import { clearTwoFactorState } from '../modules/auth/two-factor-state';

/** Failed notices hold no secret; kept a day like the API's other security emails. */
const KEEP_FAILED_EMAIL_SECONDS = 86_400;

/**
 * Who ran the command, for the audit line. `os.userInfo()` throws when the uid has no passwd
 * entry (common in containers), so fall back to the environment and never fail the command.
 */
function operatorName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER || process.env.USERNAME || 'unknown';
  }
}

/**
 * Adds the user commands to the platform owner CLI. Like the school commands they run on the
 * owner-role client, throw on errors (`cli.ts` turns that into an exit code) and write one
 * structured line saying who did what and why.
 */
export function registerUserCommands(
  program: Command,
  app: INestApplicationContext,
  out: (line: string) => void,
): void {
  const platform = app.get(PlatformPrismaService);

  program
    .command('users:disable-2fa')
    .description('Turn off two-step sign-in for a user who lost their phone and recovery codes')
    .argument('<email>')
    .requiredOption('--reason <text>', 'why two-step is being reset (e.g. a support ticket)')
    .action(async (rawEmail: string, opts: { reason: string }) => {
      const email = rawEmail.trim().toLowerCase();
      const user = await platform.user.findUnique({ where: { email } });
      if (!user) throw new Error(`User ${rawEmail.trim()} not found`);
      if (user.totpSecretEnc === null) {
        throw new Error(`Two-step sign-in is not turned on for ${user.email}`);
      }

      const by = operatorName();
      const now = new Date();
      await platform.$transaction(async (tx) => {
        await clearTwoFactorState(tx, user.id);
        await tx.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now, revokedReason: 'TWO_FACTOR_DISABLED' },
        });
        await tx.authEvent.create({ data: { type: 'TWO_FACTOR_DISABLED', userId: user.id } });
      });

      out(
        JSON.stringify({
          action: 'disable-2fa',
          email: user.email,
          reason: opts.reason,
          by,
        }),
      );

      // The reset is done; if the notice cannot be queued, say so loudly (non-zero exit).
      try {
        await app.get(EmailService).enqueue(
          {
            to: user.email,
            ...twoFactorChangedEmail({
              change: 'DISABLED',
              at: now,
              securityUrl: `${app.get<Env>(ENV).WEB_ORIGIN}/en/account/security`,
            }),
          },
          { keepFailedSeconds: KEEP_FAILED_EMAIL_SECONDS },
        );
      } catch (error) {
        throw new Error(
          `Two-step was turned off, but the email to ${user.email} could not be queued: ${String(error)}`,
          { cause: error },
        );
      }
    });
}
