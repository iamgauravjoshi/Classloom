import type { QueueProducer } from '../queue/queue.module';
import { EMAIL_QUEUE, EmailService } from './email.service';

describe('EmailService.enqueue', () => {
  it('drops completed jobs and expires failed ones within the 24h token lifetime', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const service = new EmailService({ add } as unknown as QueueProducer);
    await service.enqueue({ to: 'a@b.in', subject: 's', html: 'h', text: 't' });
    expect(add).toHaveBeenCalledWith(
      EMAIL_QUEUE,
      'send',
      expect.objectContaining({ to: 'a@b.in' }),
      expect.objectContaining({
        removeOnComplete: true,
        removeOnFail: { age: 24 * 3600 },
        attempts: 5,
      }),
    );
  });

  it('passes on a failure to queue, so the caller can roll back', async () => {
    const add = vi.fn().mockRejectedValue(new Error('Could not add a job'));
    const service = new EmailService({ add } as unknown as QueueProducer);
    await expect(
      service.enqueue({ to: 'a@b.in', subject: 's', html: 'h', text: 't' }),
    ).rejects.toThrow('Could not add a job');
  });
});
