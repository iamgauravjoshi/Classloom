import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

import type { EmailMessage } from './email-sender';

export const EMAIL_QUEUE = 'email';

@Injectable()
export class EmailService {
  constructor(@InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<EmailMessage>) {}

  async enqueue(message: EmailMessage): Promise<void> {
    await this.queue.add('send', message, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      // Job data holds a live verification link, so failed jobs must not outlive its 24h TTL.
      removeOnFail: { age: 24 * 3600 },
    });
  }
}
