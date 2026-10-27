import { Injectable } from '@nestjs/common';

import { QueueProducer } from '../queue/queue.module';
import type { EmailMessage } from './email-sender';

export const EMAIL_QUEUE = 'email';

@Injectable()
export class EmailService {
  constructor(private readonly producer: QueueProducer) {}

  /** Rejects within ENQUEUE_TIMEOUT_MS when Redis is unreachable, so callers can roll back. */
  async enqueue(message: EmailMessage): Promise<void> {
    await this.producer.add(EMAIL_QUEUE, 'send', message, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      // Job data holds a live verification link, so failed jobs must not outlive its 24h TTL.
      removeOnFail: { age: 24 * 3600 },
    });
  }
}
