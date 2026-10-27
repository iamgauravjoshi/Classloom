import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { RedisService } from '../../core/redis/redis.service';
import { identifierKey } from './crypto';

export const MAX_PASSWORD_FAILURES = 5;
export const PAUSE_SECONDS = 15 * 60;

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

  async recordFailure(tenantId: string, identifier: string): Promise<{ paused: boolean }> {
    const { fail, pause } = this.keys(tenantId, identifier);
    try {
      const count = await this.redis.client.incr(fail);
      if (count === 1) await this.redis.client.expire(fail, PAUSE_SECONDS);
      if (count < MAX_PASSWORD_FAILURES) return { paused: false };
      await this.redis.client.multi().set(pause, '1', 'EX', PAUSE_SECONDS).del(fail).exec();
      return { paused: true };
    } catch (error) {
      this.logger.warn(`Failure not counted, Redis unavailable: ${String(error)}`);
      return { paused: false };
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
