import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../core/redis/redis.service';

/** IAM mutations (roles, members, invitations): 60 per hour per user (spec §9). */
export const MAX_IAM_MUTATIONS_PER_HOUR = 60;
/** New invitations: 50 per day per school (spec §9). */
export const MAX_INVITATIONS_PER_DAY = 50;
/** Re-sends: 3 per day per invitation (spec §8). */
export const MAX_RESENDS_PER_DAY = 3;
const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86_400;

/** Atomic: counts one event and returns {count, seconds left}. KEYS[1] counter. ARGV[1] window. */
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
  countMutation(userId: string): Promise<void> {
    return this.count(`iam:mutations:${userId}`, HOUR_SECONDS, MAX_IAM_MUTATIONS_PER_HOUR, {
      title: 'Too many changes.',
      message: 'Too many changes to users and roles. Try again later.',
    });
  }

  /** Counts one new invitation at the school; 429 from the 51st in a day. Fails open. */
  countInvitation(tenantId: string): Promise<void> {
    return this.count(`iam:invitations:${tenantId}`, DAY_SECONDS, MAX_INVITATIONS_PER_DAY, {
      title: 'Too many invitations.',
      message: 'This school has sent the most invitations allowed today. Try again tomorrow.',
    });
  }

  /** Counts one re-send of an invitation; 429 from the 4th in a day. Fails open. */
  countResend(invitationId: string): Promise<void> {
    return this.count(`iam:invitation-resends:${invitationId}`, DAY_SECONDS, MAX_RESENDS_PER_DAY, {
      title: 'Too many re-sends.',
      message: 'This invitation was sent again too many times today. Try again tomorrow.',
    });
  }

  private async count(
    key: string,
    windowSeconds: number,
    limit: number,
    problem: { title: string; message: string },
  ): Promise<void> {
    let count: number;
    let retryAfter: number;
    try {
      [count, retryAfter] = (await this.redis.client.eval(COUNT_SCRIPT, 1, key, windowSeconds)) as [
        number,
        number,
      ];
    } catch (error) {
      this.logger.warn(`IAM limit not counted, Redis unavailable: ${String(error)}`);
      return;
    }
    if (count > limit) {
      throw new HttpException({ ...problem, retryAfter }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
