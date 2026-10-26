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
