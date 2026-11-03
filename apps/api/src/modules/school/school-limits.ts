import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../core/redis/redis.service';

/** Logo uploads: 10 per hour per school (onboarding spec section 5). */
export const MAX_LOGO_UPLOADS_PER_HOUR = 10;
const HOUR_SECONDS = 3600;

/** Atomic: counts one event and returns {count, seconds left}. KEYS[1] counter. ARGV[1] window. */
const COUNT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {c, math.max(redis.call('TTL', KEYS[1]), 1)}
`;

/** Rate limits of the school module, counted in Redis like `IamLimits`. */
@Injectable()
export class SchoolLimits {
  private readonly logger = new Logger(SchoolLimits.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Counts one logo upload at the school and throws 429 from the 11th in an hour. Redis errors
   * fail open: an outage must not stop a school from changing its logo.
   */
  async countLogoUpload(tenantId: string): Promise<void> {
    let count: number;
    let retryAfter: number;
    try {
      [count, retryAfter] = (await this.redis.client.eval(
        COUNT_SCRIPT,
        1,
        `school:logo-uploads:${tenantId}`,
        HOUR_SECONDS,
      )) as [number, number];
    } catch (error) {
      this.logger.warn(`Logo upload not counted, Redis unavailable: ${String(error)}`);
      return;
    }
    if (count > MAX_LOGO_UPLOADS_PER_HOUR) {
      throw new HttpException(
        {
          title: 'Too many logo uploads.',
          message: 'This school has uploaded too many logos in the last hour. Try again later.',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
