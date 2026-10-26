import type { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { withNewTenant } from './with-tenant';

function fakePrisma() {
  const calls: string[] = [];
  const tx = {
    $executeRaw: vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(`set_config:${String(values[0])}`);
      return Promise.resolve(1);
    }),
  } as unknown as Prisma.TransactionClient;
  const prisma = {
    $transaction: vi.fn((fn: (t: Prisma.TransactionClient) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;
  return { prisma, tx, calls };
}

describe('withNewTenant', () => {
  it('creates the tenant, then scopes the same transaction to it, then runs fn', async () => {
    const { prisma, tx, calls } = fakePrisma();
    const result = await withNewTenant(
      prisma,
      () => {
        calls.push('create');
        return Promise.resolve({ id: 'tenant-1' });
      },
      (innerTx, tenant) => {
        calls.push('fn');
        expect(innerTx).toBe(tx);
        return Promise.resolve(tenant.id);
      },
    );
    expect(result).toBe('tenant-1');
    expect(calls).toEqual(['create', 'set_config:tenant-1', 'fn']);
  });

  it('propagates a failure in fn so the transaction rolls back', async () => {
    const { prisma } = fakePrisma();
    await expect(
      withNewTenant(
        prisma,
        () => Promise.resolve({ id: 't' }),
        () => Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');
  });
});
