import {
  ALL_PERMISSIONS,
  canGrant,
  type ListMembersQuery,
  type Member,
  type MembersPage,
  OWNER_ROLE_KEY,
} from '@classloom/contracts';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { EmailService } from '../../core/email/email.service';
import { twoFactorResetByAdminEmail } from '../../core/email/templates/two-factor-reset-by-admin';
import { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import type { Prisma } from '../../generated/prisma/client';
import { isRecent, RecentSignInRequiredException } from '../auth/account.service';
import { AuthEventsService } from '../auth/auth-events.service';
import type { RequestAuth } from '../auth/request-auth';
import { SessionService } from '../auth/session.service';
import { clearTwoFactorState } from '../auth/two-factor-state';
import { AuditService } from './audit.service';
import { IamLimits } from './iam-limits';
import { PermissionDeniedException } from './permission.guard';

export interface MemberMeta {
  ip?: string;
  userAgent?: string;
}

export const MEMBERS_PAGE_SIZE = 25;
/** The notice holds no secret; a failed job is kept a day like the other security emails. */
const KEEP_FAILED_EMAIL_SECONDS = 86_400;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MEMBER_INCLUDE = {
  user: { select: { id: true, name: true, email: true, totpSecretEnc: true, totpEnabledAt: true } },
  roles: {
    select: {
      role: {
        select: { id: true, key: true, name: true, permissions: { select: { permission: true } } },
      },
    },
    orderBy: { role: { name: 'asc' } },
  },
} as const satisfies Prisma.MembershipInclude;
type MemberRow = Prisma.MembershipGetPayload<{ include: typeof MEMBER_INCLUDE }>;
type HeldRole = MemberRow['roles'][number]['role'];

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limits: IamLimits,
    private readonly sessions: SessionService,
    private readonly events: AuthEventsService,
    private readonly email: EmailService,
  ) {}

  /** One page of the school's members, sorted by name then id (keyset), 25 per page. */
  async list(auth: RequestAuth, query: ListMembersQuery): Promise<MembersPage> {
    const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
    const search = query.search?.trim();
    const where: Prisma.MembershipWhereInput = {
      tenantId: auth.tenantId,
      // REVOKED is a registration-cancel artefact; it is listed only when asked for.
      status: query.status ?? { in: ['ACTIVE', 'DEACTIVATED'] },
      ...(query.roleId ? { roles: { some: { roleId: query.roleId } } } : {}),
      ...(search
        ? {
            user: {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
      ...(after
        ? {
            OR: [
              { user: { name: { gt: after.name } } },
              { user: { name: after.name }, id: { gt: after.id } },
            ],
          }
        : {}),
    };

    const rows = await withTenant(this.prisma, auth.tenantId, (tx) =>
      tx.membership.findMany({
        where,
        include: MEMBER_INCLUDE,
        orderBy: [{ user: { name: 'asc' } }, { id: 'asc' }],
        take: MEMBERS_PAGE_SIZE + 1,
      }),
    );
    const page = rows.slice(0, MEMBERS_PAGE_SIZE);
    const last = page.at(-1);
    const signIns = await this.lastSignIns(
      auth.tenantId,
      page.map((r) => r.userId),
    );
    return {
      members: page.map((row) => toMember(row, signIns.get(row.userId) ?? null)),
      nextCursor:
        rows.length > MEMBERS_PAGE_SIZE && last ? encodeCursor(last.user.name, last.id) : null,
    };
  }

  /** Replaces the member's roles; every role added or removed must be within the actor's rights. */
  async setRoles(
    auth: RequestAuth,
    membershipId: string,
    roleIds: string[],
    meta: MemberMeta,
  ): Promise<Member> {
    await this.limits.countMutation(auth.userId);
    if (roleIds.some((id) => !UUID.test(id))) throw unknownRoles();
    const row = await this.write(auth, async (tx) => {
      const target = await this.loadLocked(tx, auth.tenantId, membershipId);
      const wanted = await tx.role.findMany({
        where: { id: { in: roleIds } },
        select: { id: true, key: true, name: true, permissions: { select: { permission: true } } },
      });
      if (wanted.length !== roleIds.length) throw unknownRoles();

      const held = target.roles.map((r) => r.role);
      const wantedIds = new Set(wanted.map((r) => r.id));
      const heldIds = new Set(held.map((r) => r.id));
      const added = wanted.filter((r) => !heldIds.has(r.id));
      const removed = held.filter((r) => !wantedIds.has(r.id));
      if (added.length === 0 && removed.length === 0) return target;

      const changed = [...added, ...removed];
      // Only an owner hands out or takes away Owner; any other role needs every permission held.
      if (changed.some((r) => r.key === OWNER_ROLE_KEY) && !auth.isOwner) {
        throw new PermissionDeniedException();
      }
      if (!canGrant(auth.permissions, changed.flatMap(permissionsOf))) {
        throw new PermissionDeniedException();
      }
      if (target.status === 'ACTIVE' && removed.some((r) => r.key === OWNER_ROLE_KEY)) {
        await this.assertNotLastOwner(tx, auth.tenantId, target.id);
      }

      if (removed.length > 0) {
        await tx.membershipRole.deleteMany({
          where: { membershipId: target.id, roleId: { in: removed.map((r) => r.id) } },
        });
      }
      if (added.length > 0) {
        await tx.membershipRole.createMany({
          data: added.map((r) => ({
            membershipId: target.id,
            roleId: r.id,
            tenantId: auth.tenantId,
            assignedBy: auth.userId,
          })),
        });
      }
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'member.roles_changed',
        targetType: 'membership',
        targetId: target.id,
        before: { roleIds: [...heldIds].sort() },
        after: { roleIds: [...wantedIds].sort() },
        actor: auth,
        meta,
      });
      return this.load(tx, target.id);
    });
    return this.present(auth.tenantId, row);
  }

  /** Blocks sign-in and ends the person's sessions at this school; their other schools are untouched. */
  async deactivate(auth: RequestAuth, membershipId: string, meta: MemberMeta): Promise<Member> {
    await this.limits.countMutation(auth.userId);
    const row = await this.write(auth, async (tx) => {
      const target = await this.loadLocked(tx, auth.tenantId, membershipId);
      // Compared after loading: the path may spell the same id in another case.
      if (target.id === auth.membershipId || target.userId === auth.userId) {
        throw new BadRequestException("You can't deactivate yourself.");
      }
      if (target.status === 'DEACTIVATED') return target;
      const holdsOwner = target.roles.some((r) => r.role.key === OWNER_ROLE_KEY);
      if (holdsOwner) await this.assertNotLastOwner(tx, auth.tenantId, target.id);
      if (holdsOwner && !auth.isOwner) throw new PermissionDeniedException();

      await tx.membership.update({
        where: { id: target.id },
        data: { status: 'DEACTIVATED', deactivatedAt: new Date() },
      });
      await this.sessions.revokeAllForMembership(target.id, 'MEMBER_DEACTIVATED', tx);
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'member.deactivated',
        targetType: 'membership',
        targetId: target.id,
        before: { status: 'ACTIVE' },
        after: { status: 'DEACTIVATED' },
        actor: auth,
        meta,
      });
      return this.load(tx, target.id);
    });
    return this.present(auth.tenantId, row);
  }

  async reactivate(auth: RequestAuth, membershipId: string, meta: MemberMeta): Promise<Member> {
    await this.limits.countMutation(auth.userId);
    const row = await this.write(auth, async (tx) => {
      const target = await this.loadLocked(tx, auth.tenantId, membershipId);
      if (target.status === 'ACTIVE') return target;
      // Reactivating restores their roles, so it follows the same no-escalation rule.
      const held = target.roles.map((r) => r.role);
      if (held.some((r) => r.key === OWNER_ROLE_KEY) && !auth.isOwner) {
        throw new PermissionDeniedException();
      }
      if (!canGrant(auth.permissions, held.flatMap(permissionsOf))) {
        throw new PermissionDeniedException();
      }
      await tx.membership.update({
        where: { id: target.id },
        data: { status: 'ACTIVE', deactivatedAt: null },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'member.reactivated',
        targetType: 'membership',
        targetId: target.id,
        before: { status: 'DEACTIVATED' },
        after: { status: 'ACTIVE' },
        actor: auth,
        meta,
      });
      return this.load(tx, target.id);
    });
    return this.present(auth.tenantId, row);
  }

  /**
   * Turns off another person's two-step sign-in (a lost phone and codes). Needs the admin's own
   * recent sign-in; ends the person's sessions at every school and emails them.
   */
  async resetTwoFactor(auth: RequestAuth, membershipId: string, meta: MemberMeta): Promise<void> {
    await this.limits.countMutation(auth.userId);
    if (!isRecent(auth.authenticatedAt)) throw new RecentSignInRequiredException();

    const target = await this.write(auth, async (tx) => {
      const row = await this.loadLocked(tx, auth.tenantId, membershipId);
      if (row.id === auth.membershipId || row.userId === auth.userId) {
        throw new BadRequestException(
          'Use My account › Security to change your own two-step sign-in.',
        );
      }
      if (row.roles.some((r) => r.role.key === OWNER_ROLE_KEY) && !auth.isOwner) {
        throw new PermissionDeniedException();
      }
      // The reset ends sessions at every school, so it must not reach another school's owner.
      const [elsewhere] = await tx.$queryRaw<{ owner: boolean }[]>`
        SELECT user_is_owner_elsewhere(${row.userId}::uuid, ${auth.tenantId}::uuid) AS owner`;
      if (elsewhere?.owner) throw new PermissionDeniedException();
      if (row.user.totpSecretEnc === null || row.user.totpEnabledAt === null) {
        throw new ConflictException({
          type: 'two-factor-off',
          title: 'Two-step sign-in is not on.',
          message: 'Two-step sign-in is not turned on for this person.',
        });
      }
      await clearTwoFactorState(tx, row.userId);
      await this.sessions.revokeAllForUser(row.userId, 'TWO_FACTOR_DISABLED', undefined, tx);
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'member.two_factor_reset',
        targetType: 'membership',
        targetId: row.id,
        actor: auth,
        meta,
      });
      return row;
    });

    await this.events.record({
      type: 'TWO_FACTOR_DISABLED',
      userId: target.userId,
      tenantId: auth.tenantId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    // The reset is committed; a notice that cannot be queued is logged, never thrown.
    try {
      const school = await this.prisma.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: { name: true },
      });
      await this.email.enqueue(
        {
          to: target.user.email,
          ...twoFactorResetByAdminEmail({
            schoolName: school.name,
            at: new Date(),
            securityUrl: `${this.env.WEB_ORIGIN}/en/account/security`,
          }),
        },
        { keepFailedSeconds: KEEP_FAILED_EMAIL_SECONDS },
      );
    } catch (error) {
      this.logger.warn(`Two-step reset email not queued: ${String(error)}`);
    }
  }

  /** The membership in the current school (row-level security narrows the query), or 404. */
  private async load(tx: Prisma.TransactionClient, id: string): Promise<MemberRow> {
    const row = UUID.test(id)
      ? await tx.membership.findUnique({ where: { id }, include: MEMBER_INCLUDE })
      : null;
    // REVOKED seats are a registration artefact, not people to manage.
    if (!row || row.status === 'REVOKED') throw new NotFoundException('Member not found');
    return row;
  }

  /**
   * Locks the target and the school's ACTIVE owners in one statement, in id order (so two
   * requests cannot deadlock), then loads the target. The lock is what serialises the last-owner
   * check: later statements in a READ COMMITTED transaction see what the lock holder committed.
   */
  private async loadLocked(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ): Promise<MemberRow> {
    if (!UUID.test(id)) throw new NotFoundException('Member not found');
    const target = id.toLowerCase();
    await tx.$queryRaw`
      SELECT m.id FROM memberships m
      WHERE m.tenant_id = ${tenantId}::uuid
        AND (m.id = ${target}::uuid
          OR (m.status = 'ACTIVE' AND m.id IN (
            SELECT mr.membership_id FROM membership_roles mr
            JOIN roles r ON r.id = mr.role_id
            WHERE mr.tenant_id = ${tenantId}::uuid AND r.key = ${OWNER_ROLE_KEY})))
      ORDER BY m.id
      FOR UPDATE OF m`;
    return this.load(tx, target);
  }

  /**
   * Throws 409 `last-owner` when no ACTIVE owner other than `membershipId` exists. Call it only
   * after `loadLocked`: the count is a separate statement, so it sees a fresh snapshot taken after
   * the lock. REVOKED seats that still hold Owner (a migration artefact) do not count.
   */
  private async assertNotLastOwner(
    tx: Prisma.TransactionClient,
    tenantId: string,
    membershipId: string,
  ): Promise<void> {
    const [counted] = await tx.$queryRaw<{ others: number }[]>`
      SELECT count(DISTINCT m.id)::int AS others
      FROM memberships m
      JOIN membership_roles mr ON mr.membership_id = m.id
      JOIN roles r ON r.id = mr.role_id
      WHERE m.tenant_id = ${tenantId}::uuid AND m.status = 'ACTIVE'
        AND r.key = ${OWNER_ROLE_KEY} AND m.id <> ${membershipId}::uuid`;
    if (counted?.others === 0) throw lastOwner();
  }

  /** The latest SIGN_IN_SUCCEEDED per user at this school (platform-level `auth_events`). */
  private async lastSignIns(tenantId: string, userIds: string[]): Promise<Map<string, Date>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.authEvent.groupBy({
      by: ['userId'],
      where: { type: 'SIGN_IN_SUCCEEDED', tenantId, userId: { in: userIds } },
      _max: { createdAt: true },
    });
    const out = new Map<string, Date>();
    for (const row of rows) {
      if (row.userId && row._max.createdAt) out.set(row.userId, row._max.createdAt);
    }
    return out;
  }

  private async present(tenantId: string, row: MemberRow): Promise<Member> {
    const signIns = await this.lastSignIns(tenantId, [row.userId]);
    return toMember(row, signIns.get(row.userId) ?? null);
  }

  /** One transaction scoped to the caller's school, turning lost races into clean errors. */
  private async write<T>(
    auth: RequestAuth,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await withTenant(this.prisma, auth.tenantId, fn);
    } catch (error) {
      const code = errorCode(error);
      // Two edits of the same member's roles at once, or a role deleted mid-edit.
      if (code === 'P2002') throw changedMeanwhile();
      if (code === 'P2003') throw unknownRoles();
      throw error;
    }
  }
}

function permissionsOf(role: HeldRole): string[] {
  if (role.key === OWNER_ROLE_KEY) return [...ALL_PERMISSIONS];
  return role.permissions.map((p) => p.permission).filter((p) => ALL_PERMISSIONS.includes(p));
}

function toMember(row: MemberRow, lastSignInAt: Date | null): Member {
  return {
    membershipId: row.id,
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    roles: row.roles.map(({ role }) => ({ id: role.id, key: role.key, name: role.name })),
    status: row.status,
    twoFactorEnabled: row.user.totpSecretEnc !== null && row.user.totpEnabledAt !== null,
    lastSignInAt: lastSignInAt?.toISOString() ?? null,
  };
}

function encodeCursor(name: string, id: string): string {
  return Buffer.from(JSON.stringify([name, id])).toString('base64url');
}

function decodeCursor(cursor: string): { name: string; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      UUID.test(parsed[1])
    ) {
      return { name: parsed[0], id: parsed[1] };
    }
  } catch {
    // Falls through to the 400 below.
  }
  throw new BadRequestException('The cursor is not valid.');
}

function lastOwner(): ConflictException {
  return new ConflictException({
    type: 'last-owner',
    title: 'A school needs at least one owner.',
    message: 'Make someone else an owner first.',
  });
}

function unknownRoles(): BadRequestException {
  return new BadRequestException({
    message: 'One of the roles does not exist in this school.',
    errors: [{ path: 'roleIds', message: 'One of the roles does not exist in this school.' }],
  });
}

function changedMeanwhile(): ConflictException {
  return new ConflictException({
    type: 'member-changed',
    title: 'This person was changed at the same time.',
    message: 'Reload and try again.',
  });
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? (error as { code?: unknown }).code
    : undefined;
}
