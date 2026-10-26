import type { Queue } from 'bullmq';

import { EmailService } from './email.service';
import type { EmailMessage } from './email-sender';

describe('EmailService.enqueue', () => {
  it('drops completed jobs and expires failed ones within the 24h token lifetime', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const service = new EmailService({ add } as unknown as Queue<EmailMessage>);
    await service.enqueue({ to: 'a@b.in', subject: 's', html: 'h', text: 't' });
    expect(add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ to: 'a@b.in' }),
      expect.objectContaining({
        removeOnComplete: true,
        removeOnFail: { age: 24 * 3600 },
        attempts: 5,
      }),
    );
  });
});
