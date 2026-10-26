import { Processor, WorkerHost } from '@nestjs/bullmq';
import { type BeforeApplicationShutdown } from '@nestjs/common';
import type { Job } from 'bullmq';

import { QueueConnection } from '../../core/queue/queue.module';
import { REGISTRATION_QUEUE, SchoolRegistrationService } from './school-registration.service';

/** Does the lookup, token rotation and email enqueue for a resend, off the request path. */
@Processor(REGISTRATION_QUEUE)
export class ResendVerificationProcessor extends WorkerHost implements BeforeApplicationShutdown {
  constructor(
    private readonly registrations: SchoolRegistrationService,
    private readonly connection: QueueConnection,
  ) {
    super();
  }

  async process(job: Job<{ email: string; code: string }>): Promise<void> {
    await this.registrations.processResend(job.data);
  }

  /** See EmailProcessor: force-close when Redis is unreachable so shutdown cannot hang. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.worker.close(this.connection.redis.status !== 'ready');
  }
}
