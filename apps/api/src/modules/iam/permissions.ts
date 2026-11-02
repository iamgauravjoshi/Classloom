import { ALL_PERMISSIONS, effectivePermissions } from '@classloom/contracts';

import type { Prisma } from '../../generated/prisma/client';

/** A role held by the member, as the request and the session carry it. */
export interface MemberRole {
  id: string;
  /** Built-in key (e.g. `OWNER`); null for a custom role. */
  key: string | null;
  name: string;
  requiresTwoFactor: boolean;
}

/** What a membership may do, computed from its roles on every request (spec §7). */
export interface MemberAccess {
  /** Ordered by name, so the first is a stable label. */
  roles: MemberRole[];
  /** Effective permissions: the union of the roles', every permission for an owner. */
  permissions: ReadonlySet<string>;
  isOwner: boolean;
  /** True when any held role requires two-step sign-in. */
  requiresTwoFactor: boolean;
}

export const OWNER_ROLE_KEY = 'OWNER';

/**
 * The `select` for a membership's roles and their permissions. Nest it under a membership query
 * (`select: { id: true, roles: MEMBER_ROLES_SELECT }`) so the membership check and the access load
 * are one query, under the same tenant context and row-level security.
 */
export const MEMBER_ROLES_SELECT = {
  select: {
    role: {
      select: {
        id: true,
        key: true,
        name: true,
        requiresTwoFactor: true,
        permissions: { select: { permission: true } },
      },
    },
  },
  orderBy: { role: { name: 'asc' } },
} as const satisfies Prisma.Membership$rolesArgs;

type MemberRoleRow = Prisma.MembershipRoleGetPayload<typeof MEMBER_ROLES_SELECT>;

/** Computes access from the rows `MEMBER_ROLES_SELECT` returns. No roles means no permissions. */
export function toMemberAccess(rows: readonly MemberRoleRow[]): MemberAccess {
  const held = rows.map(({ role }) => ({
    key: role.key,
    permissions: role.permissions.map((p) => p.permission),
  }));
  const effective = effectivePermissions(held);
  // Only catalogue keys count: a stored key no longer in the catalogue grants nothing.
  const permissions: ReadonlySet<string> = new Set(ALL_PERMISSIONS.filter((p) => effective.has(p)));
  const roles = rows.map(({ role }) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    requiresTwoFactor: role.requiresTwoFactor,
  }));
  return {
    roles,
    permissions,
    isOwner: roles.some((r) => r.key === OWNER_ROLE_KEY),
    requiresTwoFactor: roles.some((r) => r.requiresTwoFactor),
  };
}

/**
 * Loads a membership's roles and effective permissions in one query. `tx` must already be in the
 * membership's tenant context (a `withTenant` transaction or the scoped client).
 */
export async function loadMemberAccess(
  tx: Pick<Prisma.TransactionClient, 'membershipRole'>,
  membershipId: string,
): Promise<MemberAccess> {
  const rows = await tx.membershipRole.findMany({
    where: { membershipId },
    select: MEMBER_ROLES_SELECT.select,
    orderBy: MEMBER_ROLES_SELECT.orderBy,
  });
  return toMemberAccess(rows);
}
