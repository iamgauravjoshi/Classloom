import type {
  RecoveryCodes,
  TwoFactorCodeRequest,
  TwoFactorDisableRequest,
  TwoFactorSetup,
  TwoFactorStatus,
} from '@classloom/contracts';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { EmailService } from '../../core/email/email.service';
import {
  type TwoFactorChange,
  twoFactorChangedEmail,
} from '../../core/email/templates/two-factor-changed';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import type { Prisma } from '../../generated/prisma/client';
import { isRecent, RecentSignInRequiredException } from './account.service';
import { AuthEventsService } from './auth-events.service';
import { KnownDeviceService } from './known-device.service';
import { generateRecoveryCodes, hashRecoveryCode, normaliseRecoveryCode } from './recovery-codes';
import type { RequestAuth } from './request-auth';
import { decryptSecret, encryptSecret } from './secret-box';
import { generateTotpSecret, matchTotpStep, otpauthUrl } from './totp';
import { clearTwoFactorState } from './two-factor-state';

export const MAX_WRONG_TWO_FACTOR_CODES = 5;
export const TWO_FACTOR_PAUSE_SECONDS = 15 * 60;
/** How long a started setup waits for its first code. */
export const SETUP_TTL_SECONDS = 10 * 60;
/** The security emails hold no secret; a failed job is kept a day. */
const KEEP_FAILED_EMAIL_SECONDS = 86_400;
const WRONG_CODE = "That code didn't work.";

export interface SettingsMeta {
  ip?: string;
  userAgent?: string;
}

/** A 400 shaped like form validation errors, so the web form can mark the field. */
const wrongCode = (path: 'code' | 'recoveryCode'): BadRequestException =>
  new BadRequestException({
    title: 'Bad Request',
    message: 'Validation failed',
    errors: [{ path, message: WRONG_CODE }],
  });

const alreadyOn = () =>
  new ConflictException({
    title: 'Two-step sign-in is already on.',
    message: 'Two-step sign-in is already on.',
  });

const notOn = () =>
  new ConflictException({
    title: 'Two-step sign-in is not on.',
    message: 'Two-step sign-in is not on.',
  });

const setupExpired = () =>
  new GoneException({
    title: 'This setup has expired. Start again.',
    message: 'This setup has expired. Start again.',
  });

const isOn = (user: { totpSecretEnc: Uint8Array | null; totpEnabledAt: Date | null }): boolean =>
  user.totpSecretEnc !== null && user.totpEnabledAt !== null;

function assertRecent(auth: RequestAuth): void {
  if (!isRecent(auth.authenticatedAt)) throw new RecentSignInRequiredException();
}

export class TwoFactorPausedException extends HttpException {
  constructor(retryAfter: number) {
    super(
      {
        type: 'two-factor-paused',
        title: 'Too many wrong codes.',
        message: 'Too many wrong codes. Try again later.',
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** The user fields a code check needs. */
export interface TwoFactorUser {
  id: string;
  totpSecretEnc: Uint8Array | null;
  totpLastStep: bigint | null;
}

export type CodeMethod = 'APP' | 'RECOVERY';

/**
 * Reserves one try before a code is compared, in one atomic step, so parallel requests cannot
 * get more than 5 per window: {-1, seconds left} when the window's tries are used up, else
 * {count, 0}. The window starts with the first try and lasts 15 minutes.
 */
const RESERVE_SCRIPT = `
local c = tonumber(redis.call('GET', KEYS[1]) or '0')
if c >= tonumber(ARGV[1]) then return {-1, math.max(redis.call('TTL', KEYS[1]), 1)} end
c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return {c, 0}
`;

/** Gives a reserved try back after a right code; never below 0 and never re-creates the key. */
const RELEASE_SCRIPT = `
local c = tonumber(redis.call('GET', KEYS[1]) or '0')
if c > 0 then redis.call('DECR', KEYS[1]) end
return 0
`;

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly events: AuthEventsService,
    private readonly devices: KnownDeviceService,
    private readonly email: EmailService,
  ) {}

  private wrongKey = (userId: string) => `auth:2fa-wrong:${userId}`;
  private setupKey = (userId: string) => `auth:2fa-setup:${userId}`;

  async status(auth: RequestAuth): Promise<TwoFactorStatus> {
    const user = await this.user(auth.userId);
    const enabled = isOn(user);
    return {
      enabled,
      enabledAt: enabled ? (user.totpEnabledAt as Date).toISOString() : null,
      recoveryCodesLeft: enabled
        ? await this.prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } })
        : 0,
    };
  }

  /** Makes a secret and keeps it, encrypted, for 10 minutes until the first code proves the app has it. */
  async startSetup(auth: RequestAuth): Promise<TwoFactorSetup> {
    assertRecent(auth);
    const user = await this.user(auth.userId);
    if (isOn(user)) throw alreadyOn();
    const secret = generateTotpSecret();
    const box = encryptSecret(this.env.TOTP_ENCRYPTION_KEY, secret).toString('base64');
    await this.guard(() =>
      this.redis.client.set(this.setupKey(user.id), box, 'EX', SETUP_TTL_SECONDS),
    );
    return { secret, otpauthUrl: otpauthUrl(user.email, secret) };
  }

  async enable(
    auth: RequestAuth,
    input: TwoFactorCodeRequest,
    meta: SettingsMeta = {},
  ): Promise<RecoveryCodes> {
    assertRecent(auth);
    const user = await this.user(auth.userId);
    if (isOn(user)) throw alreadyOn();

    const stored = await this.guard(() => this.redis.client.get(this.setupKey(user.id)));
    if (!stored) throw setupExpired();
    const secret = decryptSecret(this.env.TOTP_ENCRYPTION_KEY, Buffer.from(stored, 'base64'));

    // Counted before the code is compared, like every other code check; given back when right.
    await this.reserveCodeAttempt(user.id);
    const now = new Date();
    const step = matchTotpStep(secret, input.code, now, null);
    if (step === null) throw wrongCode('code');
    await this.releaseCodeAttempt(user.id);

    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      // Only one of two parallel enables wins; the loser finds the secret already stored.
      const { count } = await tx.user.updateMany({
        where: { id: user.id, totpSecretEnc: null },
        data: {
          totpSecretEnc: new Uint8Array(encryptSecret(this.env.TOTP_ENCRYPTION_KEY, secret)),
          totpEnabledAt: now,
          totpLastStep: step,
        },
      });
      if (count === 0) throw alreadyOn();
      await this.replaceRecoveryCodes(tx, user.id, recoveryCodes);
      // The requirement is met: clear the stored flag on all the user's sessions.
      await tx.session.updateMany({
        where: { userId: user.id, twoFactorSetupRequired: true },
        data: { twoFactorSetupRequired: false },
      });
      // A trust write that raced an earlier disable must not carry over into the new setup.
      await this.devices.clearTrustForUser(user.id, tx);
    });
    await this.redis.client.del(this.setupKey(user.id)).catch(() => undefined);

    await this.afterChange('TWO_FACTOR_ENABLED', 'ENABLED', user.email, auth, meta, now);
    return { recoveryCodes };
  }

  /** New recovery codes; needs a current app code (a recovery code is not accepted here). */
  async regenerateRecoveryCodes(
    auth: RequestAuth,
    input: TwoFactorCodeRequest,
    meta: SettingsMeta = {},
  ): Promise<RecoveryCodes> {
    assertRecent(auth);
    const user = await this.user(auth.userId);
    if (!isOn(user)) throw notOn();
    if ((await this.verifyCodeWithLimit(user, { code: input.code })) === null) {
      throw wrongCode('code');
    }

    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.$transaction((tx) => this.replaceRecoveryCodes(tx, user.id, recoveryCodes));
    await this.afterChange(
      'RECOVERY_CODES_REGENERATED',
      'CODES_REGENERATED',
      user.email,
      auth,
      meta,
    );
    return { recoveryCodes };
  }

  async disable(
    auth: RequestAuth,
    input: TwoFactorDisableRequest,
    meta: SettingsMeta = {},
  ): Promise<void> {
    assertRecent(auth);
    const user = await this.user(auth.userId);
    if (!isOn(user)) throw notOn();
    if ((await this.verifyCodeWithLimit(user, input)) === null) {
      throw wrongCode(input.code !== undefined ? 'code' : 'recoveryCode');
    }

    await this.prisma.$transaction(async (tx) => {
      await clearTwoFactorState(tx, user.id);
    });
    await this.afterChange('TWO_FACTOR_DISABLED', 'DISABLED', user.email, auth, meta);
  }

  private async replaceRecoveryCodes(
    tx: Prisma.TransactionClient,
    userId: string,
    codes: string[],
  ): Promise<void> {
    await tx.recoveryCode.deleteMany({ where: { userId } });
    await tx.recoveryCode.createMany({
      data: codes.map((code) => ({
        userId,
        codeHash: hashRecoveryCode(this.env.AUTH_SECRET, normaliseRecoveryCode(code)),
      })),
    });
  }

  /** The audit event, then the email. The change is already committed, so neither can fail it. */
  private async afterChange(
    type: 'TWO_FACTOR_ENABLED' | 'TWO_FACTOR_DISABLED' | 'RECOVERY_CODES_REGENERATED',
    change: TwoFactorChange,
    to: string,
    auth: RequestAuth,
    meta: SettingsMeta,
    at = new Date(),
  ): Promise<void> {
    await this.events.record({
      type,
      userId: auth.userId,
      tenantId: auth.tenantId,
      sessionId: auth.sessionId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    try {
      await this.email.enqueue(
        {
          to,
          ...twoFactorChangedEmail({
            change,
            at,
            securityUrl: `${this.env.WEB_ORIGIN}/en/account/security`,
          }),
        },
        { keepFailedSeconds: KEEP_FAILED_EMAIL_SECONDS },
      );
    } catch (error) {
      this.logger.warn(`Two-step ${change} email not queued: ${String(error)}`);
    }
  }

  private async user(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException();
    return user;
  }

  /**
   * Checks an app or recovery code against the user's current state, then marks it used with a
   * conditional update, so the same code works once even across parallel requests: the app code's
   * step must be newer than `totp_last_step`, a recovery code must still have `used_at` null.
   * Returns which kind matched, or null (also when two-step is off).
   */
  async verifyCodeForUser(
    user: TwoFactorUser,
    input: { code?: string; recoveryCode?: string },
    now = new Date(),
  ): Promise<CodeMethod | null> {
    if (!user.totpSecretEnc) return null;

    if (input.code !== undefined) {
      const secret = decryptSecret(this.env.TOTP_ENCRYPTION_KEY, Buffer.from(user.totpSecretEnc));
      const step = matchTotpStep(secret, input.code, now, user.totpLastStep);
      if (step === null) return null;
      const updated = await this.prisma.$executeRaw`
        UPDATE users SET totp_last_step = ${step}
        WHERE id = ${user.id}::uuid
          AND totp_secret_enc IS NOT NULL
          AND (totp_last_step IS NULL OR totp_last_step < ${step})`;
      return updated === 1 ? 'APP' : null;
    }

    if (input.recoveryCode !== undefined) {
      const normalised = normaliseRecoveryCode(input.recoveryCode);
      if (normalised === '') return null;
      const { count } = await this.prisma.recoveryCode.updateMany({
        where: {
          userId: user.id,
          codeHash: hashRecoveryCode(this.env.AUTH_SECRET, normalised),
          usedAt: null,
        },
        data: { usedAt: now },
      });
      return count === 1 ? 'RECOVERY' : null;
    }
    return null;
  }

  /**
   * `verifyCodeForUser` under the per-user limit (5 wrong codes per 15 minutes, at sign-in and
   * on the account endpoints alike). The try is counted before the code is checked and given back
   * when the code is right, so parallel guesses cannot exceed the limit. Throws
   * `TwoFactorPausedException` (429) when the limit is reached, 503 when Redis is down.
   */
  async verifyCodeWithLimit(
    user: TwoFactorUser,
    input: { code?: string; recoveryCode?: string },
    now = new Date(),
  ): Promise<CodeMethod | null> {
    await this.reserveCodeAttempt(user.id);
    const method = await this.verifyCodeForUser(user, input, now);
    if (method) await this.releaseCodeAttempt(user.id);
    return method;
  }

  /** Counts one try for the user; throws 429 once 5 wrong codes were made in the window. */
  async reserveCodeAttempt(userId: string): Promise<void> {
    const [state, value] = (await this.guard(() =>
      this.redis.client.eval(
        RESERVE_SCRIPT,
        1,
        this.wrongKey(userId),
        MAX_WRONG_TWO_FACTOR_CODES,
        TWO_FACTOR_PAUSE_SECONDS,
      ),
    )) as [number, number];
    if (state < 0) throw new TwoFactorPausedException(value);
  }

  /** Gives back a try reserved for a code that turned out right. */
  async releaseCodeAttempt(userId: string): Promise<void> {
    try {
      await this.redis.client.eval(RELEASE_SCRIPT, 1, this.wrongKey(userId));
    } catch (error) {
      // Only makes the limit stricter for a while; the code was right, so carry on.
      this.logger.warn(`Two-step try not given back, Redis unavailable: ${String(error)}`);
    }
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logger.warn(`Two-step limit unavailable, Redis error: ${String(error)}`);
      throw new ServiceUnavailableException({
        title: 'Service temporarily unavailable.',
        message: 'We could not check the code right now. Try again in a moment.',
      });
    }
  }
}
