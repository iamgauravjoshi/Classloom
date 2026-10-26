import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

import { TenantContextMissingError } from './errors';

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** Holds the current tenant ID for the duration of an async call chain (a request or a job). */
@Injectable()
export class TenantContext {
  private readonly storage = new AsyncLocalStorage<string>();

  /**
   * Runs `fn` with `tenantId` as the current tenant. A returned thenable is started inside the
   * context: Prisma queries are lazy and only execute on `then`, so without this,
   * `run(A, () => prisma.scoped.campus.findMany())` would execute after `run` returned, under
   * whatever tenant (or none) the caller had.
   */
  run<T>(tenantId: string, fn: () => T): T {
    if (!tenantId) throw new TenantContextMissingError('Cannot run with an empty tenant id');
    return this.storage.run(tenantId, () => {
      const result = fn();
      return (isThenable(result) ? Promise.resolve(result) : result) as T;
    });
  }

  current(): string | undefined {
    return this.storage.getStore();
  }

  require(): string {
    const tenantId = this.current();
    if (!tenantId) throw new TenantContextMissingError();
    return tenantId;
  }
}
