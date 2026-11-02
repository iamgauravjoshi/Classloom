import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { RedisService } from '../../core/redis/redis.service';
import { randomToken, sha256 } from './crypto';

/** How the first factor was proved: a password, an emailed code, or an invitation link. */
export type FirstFactorMethod = 'PASSWORD' | 'EMAIL_CODE' | 'INVITE';

export const CHALLENGE_TTL_SECONDS = 300;
export const CHALLENGE_ATTEMPTS = 5;

/** What a pending two-step sign-in remembers. Never the raw challenge or any secret. */
export interface ChallengeData {
  userId: string;
  tenantId: string;
  membershipId: string;
  remember: boolean;
  method: FirstFactorMethod;
  /** ISO string of `password_changed_at` when the first factor was checked. */
  passwordChangedAt: string | null;
}

export type AttemptedChallenge = ChallengeData & { attemptsLeft: number };

/**
 * Spends one try in one atomic step. Returns nothing when the challenge is missing or its tries
 * are used up, else the data with the tries left after this one. The key is kept at 0 so a right
 * code on the last try can still be consumed; a wrong one deletes it (`discard`).
 */
const ATTEMPT_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if not v then return false end
local o = cjson.decode(v)
if o.attemptsLeft <= 0 then return false end
o.attemptsLeft = o.attemptsLeft - 1
redis.call('SET', KEYS[1], cjson.encode(o), 'KEEPTTL')
return cjson.encode(o)
`;

/**
 * The short-lived state between a correct first factor and the app code. Only the challenge's
 * SHA-256 is the Redis key. Redis errors answer 503: without the store there is no safe answer.
 */
@Injectable()
export class TwoFactorChallengeService {
  private readonly logger = new Logger(TwoFactorChallengeService.name);

  constructor(private readonly redis: RedisService) {}

  private key = (challenge: string) => `auth:2fa:${sha256(challenge).toString('hex')}`;

  async create(data: ChallengeData): Promise<{ challenge: string; expiresAt: Date }> {
    const challenge = randomToken();
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
    await this.guard(() =>
      this.redis.client.set(
        this.key(challenge),
        JSON.stringify({ ...data, attemptsLeft: CHALLENGE_ATTEMPTS }),
        'EX',
        CHALLENGE_TTL_SECONDS,
      ),
    );
    return { challenge, expiresAt };
  }

  /** Spends a try: the data and tries left, or 'expired' when missing or used up. */
  async attempt(challenge: string): Promise<AttemptedChallenge | 'expired'> {
    const raw = await this.guard(() =>
      this.redis.client.eval(ATTEMPT_SCRIPT, 1, this.key(challenge)),
    );
    if (typeof raw !== 'string') return 'expired';
    return JSON.parse(raw) as AttemptedChallenge;
  }

  /** Single use: true only for the one caller whose GETDEL removed it. */
  async consume(challenge: string): Promise<boolean> {
    const value = await this.guard(() => this.redis.client.getdel(this.key(challenge)));
    return value !== null;
  }

  /** Drops the challenge (no tries left, or two-step was turned off meanwhile). */
  async discard(challenge: string): Promise<void> {
    await this.guard(() => this.redis.client.del(this.key(challenge)));
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logger.warn(`Two-step challenge unavailable, Redis error: ${String(error)}`);
      throw new ServiceUnavailableException({
        title: 'Service temporarily unavailable.',
        message: 'We could not check the sign-in right now. Try again in a moment.',
      });
    }
  }
}
