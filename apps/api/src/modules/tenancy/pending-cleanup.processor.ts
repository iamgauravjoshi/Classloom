import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { type BeforeApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { QueueConnection } from '../../core/queue/queue.module';
import {
  MAINTENANCE_QUEUE,
  PendingCleanupService,
  PURGE_PENDING_JOB,
} from './pending-cleanup.service';

/** Hourly purge of unverified registrations. */
@Processor(MAINTENANCE_QUEUE)
export class PendingCleanupProcessor
  extends WorkerHost
  implements OnModuleInit, BeforeApplicationShutdown
{
  constructor(
    private readonly cleanup: PendingCleanupService,
    private readonly connection: QueueConnection,
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  /** Upserting by a fixed scheduler id keeps one schedule across restarts and instances. */
  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      PURGE_PENDING_JOB,
      { every: 3_600_000 },
      {
        name: PURGE_PENDING_JOB,
        data: {},
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
  }

  async process(): Promise<{ tenants: number; users: number }> {
    return this.cleanup.purgeExpired();
  }

  /** See EmailProcessor: force-close when Redis is unreachable so shutdown cannot hang. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.worker.close(this.connection.redis.status !== 'ready');
  }
}
