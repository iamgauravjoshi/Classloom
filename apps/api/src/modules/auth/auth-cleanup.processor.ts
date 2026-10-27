import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { type BeforeApplicationShutdown, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { PrismaService } from '../../core/prisma/prisma.service';
import { QueueConnection } from '../../core/queue/queue.module';

/**
 * Its own queue: PendingCleanupProcessor consumes every job on `maintenance` regardless of name,
 * so a second processor there would run each job twice (and the wrong work for each).
 */
export const AUTH_MAINTENANCE_QUEUE = 'auth-maintenance';
export const AUTH_CLEANUP_JOB = 'auth-cleanup';

const DAY = 86_400_000;
const SESSION_RETENTION_DAYS = 7;
const EVENT_RETENTION_DAYS = 365;

/** Daily: deletes sessions expired or revoked over 7 days ago, and auth events over a year old. */
@Processor(AUTH_MAINTENANCE_QUEUE)
export class AuthCleanupProcessor
  extends WorkerHost
  implements OnModuleInit, BeforeApplicationShutdown
{
  private readonly logger = new Logger(AuthCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connection: QueueConnection,
    @InjectQueue(AUTH_MAINTENANCE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  /** Upserting by a fixed scheduler id keeps one schedule across restarts and instances. */
  onModuleInit(): Promise<void> {
    // Not awaited: with Redis unreachable the queue connection retries forever, and boot must
    // not hang on it (the API starts without Redis; health reports it down).
    this.queue
      .upsertJobScheduler(
        AUTH_CLEANUP_JOB,
        { every: DAY },
        {
          name: AUTH_CLEANUP_JOB,
          data: {},
          opts: { removeOnComplete: true, removeOnFail: 100 },
        },
      )
      .catch((error: unknown) => {
        this.logger.warn(`Could not schedule ${AUTH_CLEANUP_JOB}: ${String(error)}`);
      });
    return Promise.resolve();
  }

  async purge(now = new Date()): Promise<{ sessions: number; events: number }> {
    const sessionCutoff = new Date(now.getTime() - SESSION_RETENTION_DAYS * DAY);
    const eventCutoff = new Date(now.getTime() - EVENT_RETENTION_DAYS * DAY);
    const [sessions, events] = await this.prisma.$transaction([
      this.prisma.session.deleteMany({
        where: { OR: [{ expiresAt: { lt: sessionCutoff } }, { revokedAt: { lt: sessionCutoff } }] },
      }),
      this.prisma.authEvent.deleteMany({ where: { createdAt: { lt: eventCutoff } } }),
    ]);
    return { sessions: sessions.count, events: events.count };
  }

  async process(): Promise<{ sessions: number; events: number }> {
    const counts = await this.purge();
    this.logger.log(`Purged old sessions and auth events: ${JSON.stringify(counts)}`);
    return counts;
  }

  /** See EmailProcessor: force-close when Redis is unreachable so shutdown cannot hang. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.worker.close(this.connection.redis.status !== 'ready');
  }
}
