import {
  ALL_PERMISSIONS,
  BUILT_IN_ROLE_DEFAULTS,
  BUILT_IN_ROLE_KEYS,
  type BuiltInRoleKey,
  canGrant,
  type CreateRoleRequest,
  OWNER_ROLE_KEY,
  PERMISSION_CATALOGUE,
  type PermissionCatalogueResponse,
  type Role,
  type RolesResponse,
  type UpdateRoleRequest,
} from '@classloom/contracts';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import type { Prisma } from '../../generated/prisma/client';
import type { RequestAuth } from '../auth/request-auth';
import { AuditService } from './audit.service';
import { IamLimits } from './iam-limits';
import { PermissionDeniedException } from './permission.guard';

export interface RoleMeta {
  ip?: string;
  userAgent?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_TAKEN = 'A role with this name already exists.';

const ROLE_INCLUDE = {
  permissions: { select: { permission: true } },
  _count: { select: { members: true } },
} as const satisfies Prisma.RoleInclude;
type RoleRow = Prisma.RoleGetPayload<{ include: typeof ROLE_INCLUDE }>;

/** The editable state of a role, as the audit trail records it. */
type RoleState = {
  name: string;
  description: string | null;
  requiresTwoFactor: boolean;
  permissions: string[];
};

/** What a change wants the role to become; a missing field stays as it is. */
type RoleChange = Partial<RoleState>;

const BUILT_IN_ORDER = new Map<string, number>(BUILT_IN_ROLE_KEYS.map((key, i) => [key, i]));

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limits: IamLimits,
  ) {}

  async list(): Promise<RolesResponse> {
    const rows = await this.prisma.scoped.role.findMany({ include: ROLE_INCLUDE });
    const roles = rows.map(toRole).sort((a, b) => {
      const ao = a.key === null ? Infinity : (BUILT_IN_ORDER.get(a.key) ?? Infinity);
      const bo = b.key === null ? Infinity : (BUILT_IN_ORDER.get(b.key) ?? Infinity);
      return ao - bo || a.name.localeCompare(b.name);
    });
    return { roles };
  }

  catalogue(): PermissionCatalogueResponse {
    return {
      modules: PERMISSION_CATALOGUE.map((entry) => ({
        module: entry.module,
        actions: [...entry.actions],
        keys: entry.actions.map((action) => `${entry.module}.${action}`),
        labelKey: `iam.permissions.modules.${entry.module}`,
      })),
    };
  }

  async create(auth: RequestAuth, input: CreateRoleRequest, meta: RoleMeta): Promise<Role> {
    await this.limits.countMutation(auth.userId);
    return this.write(auth, async (tx) => {
      const source = input.cloneFromRoleId ? await this.load(tx, input.cloneFromRoleId) : null;
      // A copy of Owner holds every permission, and only an owner may hand those out.
      if (source?.key === OWNER_ROLE_KEY && !auth.isOwner) throw new PermissionDeniedException();

      // The body's permissions win; an empty list on a clone means "as the source has it".
      const permissions = sortedUnique(
        source && input.permissions.length === 0 ? permissionsOf(source) : input.permissions,
      );
      if (!canGrant(auth.permissions, permissions)) throw new PermissionDeniedException();

      await this.assertNameFree(tx, input.name);
      const description = normaliseDescription(input.description ?? source?.description);
      const created = await tx.role.create({
        data: {
          tenantId: auth.tenantId,
          name: input.name,
          description,
          requiresTwoFactor: input.requiresTwoFactor,
          permissions: { create: permissions.map((permission) => ({ permission })) },
        },
        include: ROLE_INCLUDE,
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'role.created',
        targetType: 'role',
        targetId: created.id,
        after: stateOf(created),
        actor: auth,
        meta,
      });
      return toRole(created);
    });
  }

  async update(
    auth: RequestAuth,
    id: string,
    input: UpdateRoleRequest,
    meta: RoleMeta,
  ): Promise<Role> {
    await this.limits.countMutation(auth.userId);
    return this.write(auth, async (tx) => {
      const role = await this.load(tx, id);
      const change: RoleChange = {};
      if (input.name !== undefined) change.name = input.name;
      if (input.description !== undefined)
        change.description = normaliseDescription(input.description);
      if (input.requiresTwoFactor !== undefined) change.requiresTwoFactor = input.requiresTwoFactor;
      if (input.permissions !== undefined) change.permissions = sortedUnique(input.permissions);

      const current = stateOf(role);
      if (role.key === OWNER_ROLE_KEY) {
        // Owner is fixed: only its two-step requirement can change, and only an owner may change it.
        if (change.permissions !== undefined) {
          throw new BadRequestException("Owner's permissions can't be changed.");
        }
        if (change.name !== undefined && change.name !== current.name) {
          throw new BadRequestException("Owner can't be renamed.");
        }
        if (change.description !== undefined && change.description !== current.description) {
          throw new BadRequestException("Owner's description can't be changed.");
        }
        if (
          change.requiresTwoFactor !== undefined &&
          change.requiresTwoFactor !== current.requiresTwoFactor &&
          !auth.isOwner
        ) {
          throw new PermissionDeniedException();
        }
      } else if (role.key !== null && change.name !== undefined && change.name !== current.name) {
        throw new BadRequestException("A built-in role can't be renamed.");
      }
      return this.apply(tx, auth, role, change, meta);
    });
  }

  /** Restores a built-in role's description, two-step requirement and permissions (spec §5). */
  async reset(auth: RequestAuth, id: string, meta: RoleMeta): Promise<Role> {
    await this.limits.countMutation(auth.userId);
    return this.write(auth, async (tx) => {
      const role = await this.load(tx, id);
      const defaults = role.key ? BUILT_IN_ROLE_DEFAULTS[role.key as BuiltInRoleKey] : undefined;
      if (!defaults) throw new BadRequestException('Only a built-in role can be reset.');
      if (role.key === OWNER_ROLE_KEY && !auth.isOwner) throw new PermissionDeniedException();

      const change: RoleChange = {
        description: defaults.description,
        requiresTwoFactor: defaults.requiresTwoFactor,
      };
      // Owner holds everything without stored rows, so there are no permissions to restore.
      if (role.key !== OWNER_ROLE_KEY) {
        change.permissions = sortedUnique(
          defaults.permissions === 'ALL' ? ALL_PERMISSIONS : defaults.permissions,
        );
      }
      return this.apply(tx, auth, role, change, meta);
    });
  }

  async remove(auth: RequestAuth, id: string, meta: RoleMeta): Promise<void> {
    await this.limits.countMutation(auth.userId);
    await this.write(auth, async (tx) => {
      const role = await this.load(tx, id);
      if (role.key !== null) throw new BadRequestException("A built-in role can't be deleted.");
      if (role._count.members > 0) throw roleInUse();
      await tx.role.delete({ where: { id: role.id } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'role.deleted',
        targetType: 'role',
        targetId: role.id,
        before: stateOf(role),
        actor: auth,
        meta,
      });
    });
  }

  /**
   * Applies `change` to `role`: checks that every permission added or removed is one the actor
   * holds (no escalation), writes the difference and one audit row. A change that alters nothing
   * writes nothing.
   */
  private async apply(
    tx: Prisma.TransactionClient,
    auth: RequestAuth,
    role: RoleRow,
    change: RoleChange,
    meta: RoleMeta,
  ): Promise<Role> {
    const current = stateOf(role);
    const before: Partial<RoleState> = {};
    const after: Partial<RoleState> = {};
    const note = <K extends keyof RoleState>(key: K, next: RoleState[K] | undefined) => {
      if (next === undefined || sameValue(current[key], next)) return;
      before[key] = current[key];
      after[key] = next;
    };
    note('name', change.name);
    note('description', change.description);
    note('requiresTwoFactor', change.requiresTwoFactor);
    note('permissions', change.permissions);
    if (Object.keys(after).length === 0) return toRole(role);

    const added = (after.permissions ?? []).filter((p) => !current.permissions.includes(p));
    const removed = (before.permissions ?? []).filter(
      (p) => !(after.permissions ?? []).includes(p),
    );
    // A permission the actor lacks can be neither handed out nor taken away.
    if (!canGrant(auth.permissions, [...added, ...removed])) throw new PermissionDeniedException();
    // Turning two-step off weakens everyone holding the role: only someone who holds all the
    // role's permissions may do it (spec §16). Turning it on stays open to any editor.
    if (
      before.requiresTwoFactor === true &&
      after.requiresTwoFactor === false &&
      !canGrant(auth.permissions, permissionsOf(role))
    ) {
      throw new PermissionDeniedException();
    }

    if (after.name !== undefined) await this.assertNameFree(tx, after.name, role.id);
    await tx.role.update({
      where: { id: role.id },
      data: {
        ...(after.name !== undefined ? { name: after.name } : {}),
        ...(after.description !== undefined ? { description: after.description } : {}),
        ...(after.requiresTwoFactor !== undefined
          ? { requiresTwoFactor: after.requiresTwoFactor }
          : {}),
        updatedAt: new Date(),
      },
    });
    if (removed.length > 0) {
      await tx.rolePermission.deleteMany({
        where: { roleId: role.id, permission: { in: removed } },
      });
    }
    if (added.length > 0) {
      await tx.rolePermission.createMany({
        data: added.map((permission) => ({ roleId: role.id, tenantId: auth.tenantId, permission })),
      });
    }
    await this.audit.record(tx, {
      tenantId: auth.tenantId,
      action: after.permissions ? 'role.permissions_changed' : 'role.updated',
      targetType: 'role',
      targetId: role.id,
      before,
      after,
      actor: auth,
      meta,
    });
    return toRole(await this.load(tx, role.id));
  }

  /** The role in the current school (row-level security narrows the query), or 404. */
  private async load(tx: Prisma.TransactionClient, id: string): Promise<RoleRow> {
    const role = UUID.test(id)
      ? await tx.role.findUnique({ where: { id }, include: ROLE_INCLUDE })
      : null;
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  private async assertNameFree(
    tx: Prisma.TransactionClient,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const taken = await tx.role.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (taken) throw nameTaken();
  }

  /** One transaction scoped to the caller's school, turning a lost uniqueness race into a 409. */
  private async write<T>(
    auth: RequestAuth,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await withTenant(this.prisma, auth.tenantId, fn);
    } catch (error) {
      if (errorCode(error) === 'P2002') {
        const target = JSON.stringify((error as { meta?: unknown }).meta ?? '').toLowerCase();
        // A concurrent edit of the same role's permissions collides on role_permissions' key.
        if (target.includes('role_permissions_pkey')) throw roleChangedMeanwhile();
        if (target.includes('roles_tenant_id_name_key')) throw nameTaken();
      }
      if (errorCode(error) === 'P2003') throw roleInUse();
      throw error;
    }
  }
}

function nameTaken(): ConflictException {
  return new ConflictException({
    message: NAME_TAKEN,
    errors: [{ path: 'name', message: NAME_TAKEN }],
  });
}

function roleChangedMeanwhile(): ConflictException {
  return new ConflictException({
    type: 'role-changed',
    title: 'This role was changed at the same time.',
    message: 'Reload the role and try again.',
  });
}

function roleInUse(): ConflictException {
  return new ConflictException({
    type: 'role-in-use',
    title: 'This role is still assigned.',
    message: 'Move the people who hold this role to another role first.',
  });
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? (error as { code?: unknown }).code
    : undefined;
}

const sortedUnique = (keys: Iterable<string>): string[] => [...new Set(keys)].sort();
const normaliseDescription = (value: string | null | undefined): string | null =>
  value?.trim() ? value.trim() : null;

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Stored permissions that are still in the catalogue; Owner holds all of them without rows. */
function permissionsOf(role: RoleRow): string[] {
  if (role.key === OWNER_ROLE_KEY) return [...ALL_PERMISSIONS];
  return role.permissions.map((p) => p.permission).filter((p) => ALL_PERMISSIONS.includes(p));
}

function stateOf(role: RoleRow): RoleState {
  return {
    name: role.name,
    description: role.description,
    requiresTwoFactor: role.requiresTwoFactor,
    permissions: sortedUnique(permissionsOf(role)),
  };
}

function toRole(role: RoleRow): Role {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description ?? '',
    requiresTwoFactor: role.requiresTwoFactor,
    permissions: sortedUnique(permissionsOf(role)),
    memberCount: role._count.members,
  };
}
