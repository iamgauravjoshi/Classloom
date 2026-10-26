import type { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { TenantContextMissingError } from './errors';

/**
 * Runs `fn` in an interactive transaction whose first statement sets the transaction-local
 * `app.tenant_id`, so row-level security admits only that tenant's rows. Queries on `tx` are not
 * rewritten by the scoped extension: row-level security is the guard here.
 */
export function withTenant<T>(
  prisma: PrismaService,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!tenantId) throw new TenantContextMissingError('withTenant needs a tenant id');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

/**
 * For creating a tenant and its tenant-owned rows atomically: runs `createTenant` first (the
 * `tenants` table is not row-level secured), then scopes the same transaction to the new tenant's
 * id and runs `fn`. A failure anywhere rolls back the tenant too.
 */
export function withNewTenant<TTenant extends { id: string }, T>(
  prisma: PrismaService,
  createTenant: (tx: Prisma.TransactionClient) => Promise<TTenant>,
  fn: (tx: Prisma.TransactionClient, tenant: TTenant) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const tenant = await createTenant(tx);
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
    return fn(tx, tenant);
  });
}
