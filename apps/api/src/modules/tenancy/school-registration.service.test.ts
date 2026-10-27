import type { QueueProducer } from '../../core/queue/queue.module';
import { SchoolRegistrationService } from './school-registration.service';

function build(incr: number) {
  const prisma = new Proxy({}, { get: () => Promise.reject(new Error('touched prisma')) });
  const redis = { client: { incr: vi.fn().mockResolvedValue(incr), expire: vi.fn() } };
  const queue = { add: vi.fn().mockResolvedValue(undefined) };
  const service = new SchoolRegistrationService(
    prisma as never,
    {} as never,
    redis as never,
    {} as never,
    {} as never,
    queue as unknown as QueueProducer,
  );
  return { service, queue };
}

describe('SchoolRegistrationService.resend', () => {
  it('only counts the attempt and enqueues a job without a token; no lookup inline', async () => {
    const { service, queue } = build(1);
    await service.resend({ email: 'a@b.in', code: 'GISD' });
    expect(queue.add).toHaveBeenCalledWith(
      'registration',
      'resend-verification',
      { email: 'a@b.in', code: 'GISD' },
      expect.objectContaining({ removeOnComplete: true }),
    );
  });

  it('throws 429 beyond 3 and enqueues nothing', async () => {
    const { service, queue } = build(4);
    await expect(service.resend({ email: 'a@b.in', code: 'GISD' })).rejects.toMatchObject({
      status: 429,
    });
    expect(queue.add).not.toHaveBeenCalled();
  });
});
