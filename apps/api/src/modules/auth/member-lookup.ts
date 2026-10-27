import type { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';

/** Matches no membership; used so an unknown user still runs the lookup. */
const NO_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The user's ACTIVE membership in a school, read inside the tenant context. Pass `null` for an
 * unknown user: the query still runs, so a known user pays for no extra transaction.
 */
export function findActiveMembership(
  prisma: PrismaService,
  tenantId: string,
  userId: string | null | undefined,
) {
  return withTenant(prisma, tenantId, (tx) =>
    tx.membership.findFirst({
      where: { tenantId, userId: userId ?? NO_USER_ID, status: 'ACTIVE' },
      select: { id: true, role: true },
    }),
  );
}

/** A school that can be signed in to, by its code. */
export function findActiveTenant(prisma: PrismaService, code: string) {
  return prisma.tenant.findFirst({
    where: { code, status: 'ACTIVE' },
    select: { id: true, code: true, name: true, status: true },
  });
}
