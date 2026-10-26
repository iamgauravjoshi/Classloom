import type { RedisService } from '../redis/redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';

function storageWith(evalImpl: (...args: unknown[]) => Promise<unknown>) {
  const evalFn = vi.fn(evalImpl);
  const redis = { client: { eval: evalFn } } as unknown as RedisService;
  return { storage: new RedisThrottlerStorage(redis), evalFn };
}

describe('RedisThrottlerStorage', () => {
  it('maps the script reply to a throttler record (ttl in seconds, rounded up)', async () => {
    const { storage, evalFn } = storageWith(() => Promise.resolve([3, 1500, 0, 0]));
    const record = await storage.increment('key', 60_000, 5, 0, 'registration');
    expect(record).toEqual({
      totalHits: 3,
      timeToExpire: 2,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    const args = evalFn.mock.calls[0] as unknown[];
    expect(args.slice(1)).toEqual([
      2,
      'throttle:registration:key:hits',
      'throttle:registration:key:block',
      60_000,
      5,
      0,
    ]);
  });

  it('reports a block', async () => {
    const { storage } = storageWith(() => Promise.resolve([9, 1000, 1, 30_000]));
    expect(await storage.increment('k', 1000, 5, 30_000, 'x')).toEqual({
      totalHits: 9,
      timeToExpire: 1,
      isBlocked: true,
      timeToBlockExpire: 30,
    });
  });

  it('fails open when Redis errors', async () => {
    const { storage } = storageWith(() => Promise.reject(new Error('Connection is closed.')));
    const record = await storage.increment('k', 60_000, 5, 0, 'x');
    expect(record).toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });
});
