import { BullModule } from '@nestjs/bullmq';
import { type DynamicModule, Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';
import Redis from 'ioredis';

import type { Env } from '../config/env.schema';

/** Backstop for adding a job: past this, the caller gets an error (and can roll back). */
export const ENQUEUE_TIMEOUT_MS = 2000;

/** The BullMQ worker connection (distinct from `RedisService`). */
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

/**
 * Adds jobs on a connection of its own with the offline queue off, so a call made while Redis
 * is down fails at once instead of waiting for a reconnect. Request code (often inside a
 * database transaction) must enqueue through this, never through an injected `Queue`, which
 * shares the workers' wait-forever connection.
 */
export class QueueProducer implements OnApplicationShutdown {
  private readonly queues = new Map<string, Queue>();

  constructor(
    readonly redis: Redis,
    private readonly createQueue: (name: string) => Queue = (name) =>
      new Queue(name, { connection: redis }),
    private readonly timeoutMs = ENQUEUE_TIMEOUT_MS,
  ) {
    redis.on('error', () => undefined);
  }

  async add<T>(queueName: string, jobName: string, data: T, opts: JobsOptions): Promise<void> {
    const queue = this.queue(queueName);
    const deadline = Date.now() + this.timeoutMs;
    // A queue created while Redis is unreachable waits for its first connection. Give up at the
    // deadline and, crucially, never add the job afterwards: the caller has already failed (and
    // rolled back), so a late job would email a link to a token that was never stored.
    await beforeDeadline(queue.waitUntilReady(), deadline, queueName);
    await beforeDeadline(queue.add(jobName, data, opts), deadline, queueName);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((queue) => queue.close()));
    this.redis.disconnect();
  }

  private queue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = this.createQueue(name);
      this.queues.set(name, queue);
    }
    return queue;
  }
}

async function beforeDeadline<T>(work: Promise<T>, deadline: number, queue: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Could not add a job to the ${queue} queue in time`)),
      Math.max(deadline - Date.now(), 0),
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

@Global()
@Module({})
export class QueueModule {
  static forRoot(env: Env): DynamicModule {
    // Workers: blocking commands need `maxRetriesPerRequest: null` and an offline queue, so they
    // ride out a Redis restart.
    const connection = new QueueConnection(
      new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
    );
    // Producers: fail fast (see QueueProducer).
    const producer = new QueueProducer(
      new Redis(env.REDIS_URL, {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: ENQUEUE_TIMEOUT_MS,
      }),
    );
    return {
      module: QueueModule,
      imports: [BullModule.forRoot({ connection: connection.redis })],
      providers: [
        { provide: QueueConnection, useValue: connection },
        { provide: QueueProducer, useValue: producer },
      ],
      exports: [BullModule, QueueConnection, QueueProducer],
    };
  }
}
