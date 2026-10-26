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

  /** PONG within `timeoutMs`, waiting for an in-progress connection (e.g. just after startup). */
  async ping(timeoutMs = 1000): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    let onReady: (() => void) | undefined;
    try {
      const ready =
        this.client.status === 'ready'
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              onReady = resolve;
              this.client.once('ready', resolve);
            });
      const reply = await Promise.race([
        ready.then(() => this.client.ping()),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        }),
      ]);
      return reply === 'PONG';
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      if (onReady) this.client.off('ready', onReady);
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
