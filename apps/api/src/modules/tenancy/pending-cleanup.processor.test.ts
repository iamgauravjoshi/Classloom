import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { QueueConnection } from '../../core/queue/queue.module';
import { PendingCleanupProcessor } from './pending-cleanup.processor';
import type { PendingCleanupService } from './pending-cleanup.service';

function build(upsert: () => Promise<unknown>, purge = vi.fn()) {
  const queue = { upsertJobScheduler: vi.fn(upsert) } as unknown as Queue;
  const cleanup = { purgeExpired: purge } as unknown as PendingCleanupService;
  return new PendingCleanupProcessor(cleanup, {} as QueueConnection, queue);
}

describe('PendingCleanupProcessor', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not block init while the scheduler upsert never resolves', async () => {
    const processor = build(() => new Promise(() => undefined));
    const started = Date.now();
    await processor.onModuleInit();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('catches and logs a failing scheduler upsert', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const processor = build(() => Promise.reject(new Error('redis down')));
    await processor.onModuleInit();
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('redis down'));
  });

  it('logs the counts after each run', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const processor = build(
      () => Promise.resolve(),
      vi.fn().mockResolvedValue({ tenants: 2, users: 1 }),
    );
    await expect(processor.process()).resolves.toEqual({ tenants: 2, users: 1 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"tenants":2'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"users":1'));
  });
});
