import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';

import { RedisService } from '../redis/redis.service';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Atomic fixed-window counter. The guard only rejects when the storage reports `isBlocked`, so
 * going over the limit blocks for `blockDuration` (the window's remainder when 0).
 * KEYS: hits key, block key. ARGV: ttl ms, limit, block duration ms.
 * Returns { hits, ttl ms, blocked (0/1), block ttl ms }.
 */
const INCREMENT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  return { hits, math.max(redis.call('PTTL', KEYS[1]), 0), 1, blockTtl }
end
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if hits == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
if hits > tonumber(ARGV[2]) then
  local blockMs = tonumber(ARGV[3])
  if blockMs > 0 then
    redis.call('SET', KEYS[2], '1', 'PX', blockMs)
  else
    blockMs = ttl
  end
  return { hits, ttl, 1, blockMs }
end
return { hits, ttl, 0, 0 }
`;

/**
 * Throttler counters in Redis so limits hold across API instances. Fails open: if Redis is
 * unreachable the request is let through (and a warning logged); per-email caps and the unique
 * index on the school code still protect the data.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `throttle:${throttlerName}:${key}`;
    try {
      const [hits, ttlMs, blocked, blockMs] = (await this.redis.client.eval(
        INCREMENT_SCRIPT,
        2,
        `${base}:hits`,
        `${base}:block`,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number, number];
      return {
        totalHits: hits,
        timeToExpire: Math.ceil(ttlMs / 1000),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.ceil(blockMs / 1000),
      };
    } catch (error) {
      this.logger.warn(
        `Rate limit storage unavailable, allowing request: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        totalHits: 1,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
