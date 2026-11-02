import { parseIdentifier } from '@classloom/utils';

import type { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import { MEMBER_ROLES_SELECT, type MemberAccess, toMemberAccess } from '../iam/permissions';

/** Matches no membership; used so an unknown user still runs the lookup. */
const NO_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The user's ACTIVE membership in a school with its roles and effective permissions, read inside
 * the tenant context in one query. Pass `null` for an unknown user: the query still runs, so a
 * known user pays for no extra transaction.
 */
export async function findActiveMembership(
  prisma: PrismaService,
  tenantId: string,
  userId: string | null | undefined,
): Promise<{ id: string; access: MemberAccess } | null> {
  const membership = await withTenant(prisma, tenantId, (tx) =>
    tx.membership.findFirst({
      where: { tenantId, userId: userId ?? NO_USER_ID, status: 'ACTIVE' },
      select: { id: true, roles: MEMBER_ROLES_SELECT },
    }),
  );
  return membership ? { id: membership.id, access: toMemberAccess(membership.roles) } : null;
}

/** A school that can be signed in to, by its code. */
export function findActiveTenant(prisma: PrismaService, code: string) {
  return prisma.tenant.findFirst({
    where: { code, status: 'ACTIVE' },
    select: { id: true, code: true, name: true, status: true },
  });
}

/**
 * Every school a user belongs to, whatever the membership or school status: its code, and
 * whether the membership is ACTIVE in an ACTIVE school. Reads across schools through the
 * `user_schools` function, because memberships are under row-level security.
 */
export function findUserSchools(prisma: PrismaService, userId: string) {
  return prisma.$queryRaw<{ code: string; eligible: boolean }[]>`
    SELECT code, eligible FROM user_schools(${userId}::uuid)`;
}

/** The user an email or mobile identifier belongs to; nothing for anything else. */
export function findUserByIdentifier(prisma: PrismaService, identifier: string) {
  const parsed = parseIdentifier(identifier);
  if (parsed.kind === 'email') {
    return prisma.user.findUnique({ where: { email: parsed.value } });
  }
  if (parsed.kind === 'mobile') {
    return prisma.user.findFirst({ where: { mobile: parsed.value } });
  }
  return Promise.resolve(null);
}
