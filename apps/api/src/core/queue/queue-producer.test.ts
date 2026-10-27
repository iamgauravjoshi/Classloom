import type { Queue } from 'bullmq';
import type Redis from 'ioredis';

import { QueueProducer } from './queue.module';

const redis = { on: vi.fn(), disconnect: vi.fn() } as unknown as Redis;

function fakeQueue(ready: Promise<unknown>) {
  return {
    waitUntilReady: vi.fn(() => ready),
    add: vi.fn().mockResolvedValue({ id: '1' }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('QueueProducer', () => {
  it('adds the job once the queue is ready', async () => {
    const queue = fakeQueue(Promise.resolve());
    const producer = new QueueProducer(redis, () => queue as unknown as Queue, 200);
    await producer.add('email', 'send', { to: 'a@b.in' }, { attempts: 5 });
    expect(queue.add).toHaveBeenCalledWith('send', { to: 'a@b.in' }, { attempts: 5 });
  });

  it('fails within the timeout, and never adds the job later, while Redis is unreachable', async () => {
    let becomeReady: () => void = () => undefined;
    const queue = fakeQueue(new Promise<void>((resolve) => (becomeReady = resolve)));
    const producer = new QueueProducer(redis, () => queue as unknown as Queue, 200);

    const started = Date.now();
    await expect(producer.add('email', 'send', {}, {})).rejects.toThrow(/queue/i);
    expect(Date.now() - started).toBeLessThan(1000);

    // Redis comes back after the caller gave up (and rolled back): the job must not appear.
    becomeReady();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('fails within the timeout when adding stalls', async () => {
    const queue = fakeQueue(Promise.resolve());
    queue.add.mockReturnValue(new Promise(() => undefined));
    const producer = new QueueProducer(redis, () => queue as unknown as Queue, 200);
    await expect(producer.add('email', 'send', {}, {})).rejects.toThrow(/queue/i);
  });

  it('reuses one queue per name', async () => {
    const create = vi.fn(() => fakeQueue(Promise.resolve()) as unknown as Queue);
    const producer = new QueueProducer(redis, create, 200);
    await producer.add('email', 'send', {}, {});
    await producer.add('email', 'send', {}, {});
    expect(create).toHaveBeenCalledTimes(1);
  });
});
