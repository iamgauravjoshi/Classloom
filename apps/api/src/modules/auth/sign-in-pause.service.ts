import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { RedisService } from '../../core/redis/redis.service';
import { identifierKey } from './crypto';

export const MAX_PASSWORD_FAILURES = 5;
export const PAUSE_SECONDS = 15 * 60;

/** Atomic: paused -> {-1, seconds left}; attempt over the limit -> {-2, seconds left}; else {n, 0}. */
const RESERVE_SCRIPT = `
local p = redis.call('PTTL', KEYS[2])
if p > 0 then return {-1, math.ceil(p / 1000)} end
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
if c > tonumber(ARGV[1]) then return {-2, math.max(redis.call('TTL', KEYS[1]), 1)} end
return {c, 0}
`;

/**
 * Per school and identifier: 5 failed passwords pause password sign-in for 15 minutes. Keys hold
 * an HMAC of the identifier, never the raw email or mobile. Redis errors fail open (a warning is
 * logged), so an outage never locks anyone out.
 */
@Injectable()
export class SignInPauseService {
  private readonly logger = new Logger(SignInPauseService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
  ) {}

  private keys(tenantId: string, identifier: string) {
    const hash = identifierKey(this.env.AUTH_SECRET, tenantId, identifier);
    return { fail: `auth:fail:${tenantId}:${hash}`, pause: `auth:pause:${tenantId}:${hash}` };
  }

  /** Seconds left on the pause, or null when not paused. */
  async isPaused(tenantId: string, identifier: string): Promise<number | null> {
    try {
      const ttl = await this.redis.client.ttl(this.keys(tenantId, identifier).pause);
      return ttl > 0 ? ttl : null;
    } catch (error) {
      this.logger.warn(`Pause check skipped, Redis unavailable: ${String(error)}`);
      return null;
    }
  }

  /**
   * Counts this attempt before the password is checked, in one atomic step, so parallel requests
   * cannot get more than 5 guesses per window. `blockedFor` is set (seconds) when the identifier
   * is paused or the window's 5 attempts are already used; then the password must not be checked.
   */
  async reserveAttempt(
    tenantId: string,
    identifier: string,
  ): Promise<{ blockedFor: number | null; attempt: number }> {
    const { fail, pause } = this.keys(tenantId, identifier);
    try {
      const [state, value] = (await this.redis.client.eval(
        RESERVE_SCRIPT,
        2,
        fail,
        pause,
        MAX_PASSWORD_FAILURES,
        PAUSE_SECONDS,
      )) as [number, number];
      return state < 0 ? { blockedFor: value, attempt: 0 } : { blockedFor: null, attempt: state };
    } catch (error) {
      this.logger.warn(`Attempt not counted, Redis unavailable: ${String(error)}`);
      return { blockedFor: null, attempt: 0 };
    }
  }

  /**
   * After a wrong password on reserved attempt `attempt`: from the 5th on, sets the pause with
   * SET NX. `started` is true only for the request that created it, so it is recorded once.
   */
  async recordFailure(
    tenantId: string,
    identifier: string,
    attempt: number,
  ): Promise<{ paused: boolean; started: boolean }> {
    if (attempt < MAX_PASSWORD_FAILURES) return { paused: false, started: false };
    try {
      const won = await this.redis.client.set(
        this.keys(tenantId, identifier).pause,
        '1',
        'EX',
        PAUSE_SECONDS,
        'NX',
      );
      return { paused: true, started: won === 'OK' };
    } catch (error) {
      this.logger.warn(`Pause not set, Redis unavailable: ${String(error)}`);
      return { paused: false, started: false };
    }
  }

  /**
   * Re-check after a correct password: false when a concurrent flood has used up the window's
   * attempts or set the pause, so a parallel guess cannot sign in past the limit.
   */
  async allowsSuccess(tenantId: string, identifier: string): Promise<boolean> {
    const { fail, pause } = this.keys(tenantId, identifier);
    try {
      const [count, paused] = await Promise.all([
        this.redis.client.get(fail),
        this.redis.client.exists(pause),
      ]);
      return paused === 0 && Number(count ?? 0) <= MAX_PASSWORD_FAILURES;
    } catch (error) {
      this.logger.warn(`Pause re-check skipped, Redis unavailable: ${String(error)}`);
      return true;
    }
  }

  async clear(tenantId: string, identifier: string): Promise<void> {
    try {
      await this.redis.client.del(this.keys(tenantId, identifier).fail);
    } catch (error) {
      this.logger.warn(`Failure count not cleared, Redis unavailable: ${String(error)}`);
    }
  }
}
