import { Processor, WorkerHost } from '@nestjs/bullmq';
import { type BeforeApplicationShutdown } from '@nestjs/common';
import type { Job } from 'bullmq';

import { QueueConnection } from '../../core/queue/queue.module';
import {
  AUTH_QUEUE,
  EmailCodeService,
  SEND_CODE_JOB,
  type SendCodeJobData,
} from './email-code.service';
import {
  PasswordResetService,
  SEND_RESET_JOB,
  type SendResetJobData,
} from './password-reset.service';

/** The one processor of the `auth` queue; it hands each job to its service by name. */
@Processor(AUTH_QUEUE)
export class AuthProcessor extends WorkerHost implements BeforeApplicationShutdown {
  constructor(
    private readonly codes: EmailCodeService,
    private readonly resets: PasswordResetService,
    private readonly connection: QueueConnection,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case SEND_CODE_JOB:
        await this.codes.processSend(job.data as SendCodeJobData);
        return;
      case SEND_RESET_JOB:
        await this.resets.processSend(job.data as SendResetJobData);
        return;
      default:
        throw new Error(`Unknown auth job: ${job.name}`);
    }
  }

  /** See EmailProcessor: force-close when Redis is unreachable so shutdown cannot hang. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.worker.close(this.connection.redis.status !== 'ready');
  }
}
