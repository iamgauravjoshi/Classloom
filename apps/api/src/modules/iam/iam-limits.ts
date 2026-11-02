import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../core/redis/redis.service';

/** IAM mutations (roles, members, invitations): 60 per hour per user (spec §9). */
export const MAX_IAM_MUTATIONS_PER_HOUR = 60;
const WINDOW_SECONDS = 3600;

/** Atomic: counts a mutation and returns {count, seconds left}. KEYS[1] counter. ARGV[1] window. */
const COUNT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {c, math.max(redis.call('TTL', KEYS[1]), 1)}
`;

@Injectable()
export class IamLimits {
  private readonly logger = new Logger(IamLimits.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Counts one IAM mutation by `userId` and throws 429 from the 61st in an hour. Redis errors fail
   * open, like the sign-in pause: an outage must not lock administrators out.
   */
  async countMutation(userId: string): Promise<void> {
    let count: number;
    let retryAfter: number;
    try {
      [count, retryAfter] = (await this.redis.client.eval(
        COUNT_SCRIPT,
        1,
        `iam:mutations:${userId}`,
        WINDOW_SECONDS,
      )) as [number, number];
    } catch (error) {
      this.logger.warn(`IAM mutation not counted, Redis unavailable: ${String(error)}`);
      return;
    }
    if (count > MAX_IAM_MUTATIONS_PER_HOUR) {
      throw new HttpException(
        {
          title: 'Too many changes.',
          message: 'Too many changes to users and roles. Try again later.',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
