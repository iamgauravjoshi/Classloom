import { Processor, WorkerHost } from '@nestjs/bullmq';
import { type BeforeApplicationShutdown, Inject } from '@nestjs/common';
import type { Job } from 'bullmq';

import { QueueConnection } from '../queue/queue.module';
import { EMAIL_QUEUE } from './email.service';
import { EMAIL_SENDER, type EmailMessage, type EmailSender } from './email-sender';

@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost implements BeforeApplicationShutdown {
  constructor(
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
    private readonly connection: QueueConnection,
  ) {
    super();
  }

  async process(job: Job<EmailMessage>): Promise<void> {
    await this.sender.send(job.data);
  }

  /**
   * A graceful close waits on the blocked Redis connection, so it would hang shutdown forever
   * when Redis is unreachable. In that case close by force; BullMQ retries any unfinished job.
   */
  async beforeApplicationShutdown(): Promise<void> {
    await this.worker.close(this.connection.redis.status !== 'ready');
  }
}
