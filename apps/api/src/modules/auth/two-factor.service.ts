import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { hashRecoveryCode, normaliseRecoveryCode } from './recovery-codes';
import { decryptSecret } from './secret-box';
import { matchTotpStep } from './totp';

export const MAX_WRONG_TWO_FACTOR_CODES = 5;
export const TWO_FACTOR_PAUSE_SECONDS = 15 * 60;

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
  ) {}

  private wrongKey = (userId: string) => `auth:2fa-wrong:${userId}`;

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
