import { BullModule } from '@nestjs/bullmq';
import { type DynamicModule, Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';

import type { Env } from '../config/env.schema';

/** The BullMQ-dedicated Redis connection (distinct from `RedisService`). */
export class QueueConnection implements OnApplicationShutdown {
  constructor(readonly redis: Redis) {
    // Connection problems surface through BullMQ and health checks, not as unhandled events.
    redis.on('error', () => undefined);
  }

  onApplicationShutdown(): void {
    // Queues and workers hold duplicates of this connection and close those themselves.
    this.redis.disconnect();
  }
}

@Global()
@Module({})
export class QueueModule {
  /** BullMQ gets its own connection: blocking commands need `maxRetriesPerRequest: null`. */
  static forRoot(env: Env): DynamicModule {
    const connection = new QueueConnection(
      new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
    );
    return {
      module: QueueModule,
      imports: [BullModule.forRoot({ connection: connection.redis })],
      providers: [{ provide: QueueConnection, useValue: connection }],
      exports: [BullModule, QueueConnection],
    };
  }
}
