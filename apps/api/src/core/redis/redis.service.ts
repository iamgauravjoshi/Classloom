import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';

@Injectable()
export class RedisService implements OnModuleDestroy {
  /** Fails fast while Redis is down instead of queueing commands forever. */
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    // Connection errors are reported through health checks, not as unhandled events.
    this.client.on('error', () => undefined);
    this.client.connect().catch(() => undefined);
  }

  async ping(timeoutMs = 1000): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const reply = await Promise.race([
        this.client.ping(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        }),
      ]);
      return reply === 'PONG';
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
