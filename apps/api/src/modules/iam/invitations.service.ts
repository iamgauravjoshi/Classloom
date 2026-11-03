import {
  canGrant,
  type CreateInvitationRequest,
  type Invitation,
  type InvitationPreview,
  type InvitationsResponse,
  OWNER_ROLE_KEY,
} from '@classloom/contracts';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { EmailService } from '../../core/email/email.service';
import { invitationEmail } from '../../core/email/templates/invitation';
import { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import type { Prisma, TenantStatus, User } from '../../generated/prisma/client';
import { randomToken, sha256 } from '../auth/crypto';
import type { RequestAuth } from '../auth/request-auth';
import { CredentialsChangedError } from '../auth/session.service';
import {
  type DeviceSignInMeta,
  type FirstFactorOutcome,
  TwoFactorSignInService,
} from '../auth/two-factor-sign-in.service';
import { maskEmail } from '../tenancy/mask-email';
import { AuditService } from './audit.service';
import { IamLimits } from './iam-limits';
import type { MemberMeta } from './members.service';
import { PermissionDeniedException } from './permission.guard';
import { isActiveOwner, permissionsOf } from './permissions';

export const INVITATION_DAYS = 7;
const INVITATION_MS = INVITATION_DAYS * 86_400_000;
/** The email job holds the join link, so a failed job is kept no longer than the link lives. */
const KEEP_FAILED_EMAIL_SECONDS = INVITATION_DAYS * 86_400;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const INVITATION_GONE_TITLE = 'This invitation has expired or is no longer valid.';

/** One answer for unknown, expired, used, revoked and role-less invitations, and closed schools. */
export class InvitationGoneException extends GoneException {
  constructor() {
    super({
      title: INVITATION_GONE_TITLE,
      message: 'Ask the school to send a new invitation.',
    });
  }
}

/**
 * 409 `invitation-joined`: the person joined (membership ACTIVE, token spent) but was not signed
 * in. Carries the school code for the sign-in link.
 */
export class InvitationJoinedException extends ConflictException {
  constructor(schoolCode: string) {
    super({
      type: 'invitation-joined',
      title: 'You joined the school. Sign in to continue.',
      message: 'You joined the school. Sign in to continue.',
      schoolCode,
    });
  }
}

const ROLE_SELECT = {
  id: true,
  key: true,
  name: true,
  permissions: { select: { permission: true } },
} as const satisfies Prisma.RoleSelect;
type InvitedRole = Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>;
type InvitationRow = Prisma.InvitationGetPayload<object>;

interface School {
  id: string;
  code: string;
  name: string;
  status: TenantStatus;
}

/** An invitation found by its token: still open, at an ACTIVE school, with its surviving roles. */
interface OpenInvitation {
  invitation: InvitationRow;
  tenant: School;
  roles: { id: string; name: string }[];
}

/** Staff invitations (spec §8): issued by admins, accepted from the emailed link. */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limits: IamLimits,
    private readonly email: EmailService,
    private readonly signIn: TwoFactorSignInService,
  ) {}

  /** The school's open invitations (not accepted, revoked or expired), newest first. */
  list(auth: RequestAuth): Promise<InvitationsResponse> {
    const now = new Date();
    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      const rows = await tx.invitation.findMany({
        where: {
          tenantId: auth.tenantId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const roles = await tx.role.findMany({
        where: { id: { in: [...new Set(rows.flatMap((r) => r.roleIds))] } },
        select: { id: true, name: true },
      });
      const inviters = await tx.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.invitedBy))] } },
        select: { id: true, name: true },
      });
      const roleById = new Map(roles.map((r) => [r.id, r]));
      const inviterName = new Map(inviters.map((u) => [u.id, u.name]));
      return {
        invitations: rows.map((row) =>
          toInvitation(
            row,
            row.roleIds.flatMap((id) => roleById.get(id) ?? []),
            inviterName.get(row.invitedBy) ?? null,
          ),
        ),
      };
    });
  }

  /**
   * Invites a person by email with roles the inviter may grant. One open invitation per email,
   * serialised per (school, email) by a transaction-scoped advisory lock.
   */
  async create(
    auth: RequestAuth,
    body: CreateInvitationRequest,
    meta: MemberMeta,
  ): Promise<Invitation> {
    await this.limits.countMutation(auth.userId);
    if (body.roleIds.some((id) => !UUID.test(id))) throw unknownRoles();
    const roleIds = [...new Set(body.roleIds.map((id) => id.toLowerCase()))];
    const raw = randomToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_MS);

    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      await lockEmail(tx, auth.tenantId, body.email);
      const roles = await tx.role.findMany({ where: { id: { in: roleIds } }, select: ROLE_SELECT });
      if (roles.length !== roleIds.length) throw unknownRoles();
      await assertCanGrant(tx, auth, roles);
      await assertNotMember(tx, auth.tenantId, body.email);
      await assertMayReplaceOwnerSeat(tx, auth, body.email);
      await assertNotInvited(tx, auth.tenantId, body.email, now);
      // Counted only for an invitation that will be sent.
      await this.limits.countInvitation(auth.tenantId);

      const ordered = roleIds.flatMap((id) => roles.find((r) => r.id === id) ?? []);
      const row = await tx.invitation.create({
        data: {
          tenantId: auth.tenantId,
          email: body.email,
          name: body.name,
          roleIds: ordered.map((r) => r.id),
          tokenHash: new Uint8Array(sha256(raw)),
          expiresAt,
          invitedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'member.invited',
        targetType: 'invitation',
        targetId: row.id,
        after: { email: row.email, name: row.name, roleIds: row.roleIds },
        actor: auth,
        meta,
      });
      const inviterName = await this.send(tx, auth, row, ordered, raw);
      return toInvitation(row, ordered, inviterName);
    });
  }

  /** A new link and expiry; the old link stops working. At most 3 a day per invitation. */
  async resend(auth: RequestAuth, invitationId: string): Promise<Invitation> {
    await this.limits.countMutation(auth.userId);
    const raw = randomToken();
    const now = new Date();

    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      const found = await findInvitation(tx, invitationId);
      // Same lock order as create: the email first, then the row.
      await lockEmail(tx, auth.tenantId, found.email);
      const row = await lockInvitation(tx, found.id);
      if (row.acceptedAt || row.revokedAt) throw new InvitationGoneException();
      const roles = await tx.role.findMany({
        where: { id: { in: row.roleIds } },
        select: ROLE_SELECT,
      });
      if (roles.length === 0) throw new InvitationGoneException();
      // Re-issuing hands the roles out again, so the same rules apply as when inviting.
      await assertCanGrant(tx, auth, roles);
      await assertNotMember(tx, auth.tenantId, row.email);
      await assertMayReplaceOwnerSeat(tx, auth, row.email);
      await assertNotInvited(tx, auth.tenantId, row.email, now, row.id);
      await this.limits.countResend(row.id);

      const updated = await tx.invitation.update({
        where: { id: row.id },
        data: {
          tokenHash: new Uint8Array(sha256(raw)),
          expiresAt: new Date(now.getTime() + INVITATION_MS),
        },
      });
      const ordered = row.roleIds.flatMap((id) => roles.find((r) => r.id === id) ?? []);
      const inviterName = await this.send(tx, auth, updated, ordered, raw);
      return toInvitation(updated, ordered, inviterName);
    });
  }

  /** Withdraws an invitation; its link stops working. Revoking twice is a no-op. */
  async revoke(auth: RequestAuth, invitationId: string, meta: MemberMeta): Promise<void> {
    await this.limits.countMutation(auth.userId);
    await withTenant(this.prisma, auth.tenantId, async (tx) => {
      const found = await findInvitation(tx, invitationId);
      const row = await lockInvitation(tx, found.id);
      if (row.acceptedAt) throw new InvitationGoneException();
      if (row.revokedAt) return;
      await tx.invitation.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'member.invite_revoked',
        targetType: 'invitation',
        targetId: row.id,
        before: { status: 'PENDING' },
        after: { status: 'REVOKED' },
        actor: auth,
        meta,
      });
    });
  }

  /** What the join page shows. Reads only: the token is spent by `accept`. */
  async preview(token: string): Promise<InvitationPreview> {
    const open = await this.findOpen(token);
    if (!open) throw new InvitationGoneException();
    return {
      school: { code: open.tenant.code, name: open.tenant.name },
      email: maskEmail(open.invitation.email),
      name: open.invitation.name,
      roles: open.roles.map((r) => r.name),
    };
  }

  /**
   * Spends the token and joins the person to the school in one transaction under its tenant,
   * then signs them in through `completeFirstFactor` (a session, or the two-step challenge).
   */
  async accept(token: string, meta: DeviceSignInMeta): Promise<FirstFactorOutcome> {
    const hash = new Uint8Array(sha256(token));
    const located = await this.locate(hash);
    if (!located) throw new InvitationGoneException();
    const { invitationId, tenant } = located;

    let joined: { user: User; membershipId: string };
    try {
      joined = await this.join(tenant.id, invitationId, hash, meta);
    } catch (error) {
      // Another school's invitation created the same new user at the same moment: the
      // transaction rolled back whole (token unspent), so a second try finds that user.
      if (errorCode(error) !== 'P2002') throw error;
      joined = await this.join(tenant.id, invitationId, hash, meta);
    }

    try {
      return await this.signIn.completeFirstFactor(
        {
          user: joined.user,
          tenant,
          membership: { id: joined.membershipId },
          remember: false,
          method: 'INVITE',
        },
        meta,
      );
    } catch (error) {
      // The join is committed and the token spent, but no session came of it (the password
      // changed meanwhile, Redis or the session insert failed): a retry would only answer 410,
      // so say what is true. The person joined; signing in is what is left.
      if (!(error instanceof CredentialsChangedError)) {
        this.logger.warn(`Joined by invitation but not signed in: ${String(error)}`);
      }
      throw new InvitationJoinedException(tenant.code);
    }
  }

  private join(
    tenantId: string,
    invitationId: string,
    hash: Uint8Array<ArrayBuffer>,
    meta: MemberMeta,
  ): Promise<{ user: User; membershipId: string }> {
    const now = new Date();
    return withTenant(this.prisma, tenantId, async (tx) => {
      // Single use: of two parallel accepts only one claims it. The hash is matched again so a
      // link replaced by a re-send meanwhile does not count.
      const claimed = await tx.invitation.updateMany({
        where: {
          id: invitationId,
          tokenHash: hash,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now },
      });
      if (claimed.count !== 1) throw new InvitationGoneException();
      const invitation = await tx.invitation.findUniqueOrThrow({ where: { id: invitationId } });
      // Roles deleted since the invitation are skipped; with none left it is void.
      const roles = await tx.role.findMany({
        where: { id: { in: invitation.roleIds } },
        select: { id: true },
      });
      if (roles.length === 0) throw new InvitationGoneException();
      const roleIds = invitation.roleIds.filter((id) => roles.some((r) => r.id === id));

      // The email link proves the address.
      let user = await tx.user.findUnique({ where: { email: invitation.email } });
      if (!user) {
        user = await tx.user.create({
          data: { email: invitation.email, name: invitation.name, emailVerifiedAt: now },
        });
      } else if (!user.emailVerifiedAt) {
        user = await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });
      }

      // Lock the seat (if any) so a parallel deactivate or reactivate waits for the join.
      await tx.$queryRaw`
        SELECT id FROM memberships
        WHERE tenant_id = ${tenantId}::uuid AND user_id = ${user.id}::uuid
        FOR UPDATE`;
      const existing = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: user.id } },
        select: {
          id: true,
          status: true,
          roles: { select: { roleId: true, role: { select: { key: true } } } },
        },
      });
      if (existing?.status === 'ACTIVE') throw alreadyMember();
      // The seat was deactivated after the invitation went out, or the inviter lost Owner since:
      // replacing a deactivated owner's roles still needs an owner behind the invitation.
      if (
        existing?.status === 'DEACTIVATED' &&
        existing.roles.some((r) => r.role.key === OWNER_ROLE_KEY) &&
        !(await isActiveOwner(tx, tenantId, invitation.invitedBy))
      ) {
        throw new PermissionDeniedException();
      }
      let membershipId: string;
      if (existing) {
        // DEACTIVATED or REVOKED: back to ACTIVE with exactly the invited roles. A REVOKED seat
        // may still hold Owner from the migration, so the old roles are replaced, never kept.
        membershipId = existing.id;
        await tx.membership.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE', deactivatedAt: null },
        });
        await tx.membershipRole.deleteMany({ where: { membershipId: existing.id } });
      } else {
        const created = await tx.membership.create({ data: { tenantId, userId: user.id } });
        membershipId = created.id;
      }
      await tx.membershipRole.createMany({
        data: roleIds.map((roleId) => ({
          tenantId,
          membershipId,
          roleId,
          assignedBy: invitation.invitedBy,
        })),
      });
      await this.audit.record(tx, {
        tenantId,
        action: 'member.joined',
        targetType: 'membership',
        targetId: membershipId,
        before: existing
          ? { status: existing.status, roleIds: existing.roles.map((r) => r.roleId).sort() }
          : null,
        after: { status: 'ACTIVE', roleIds: [...roleIds].sort(), invitationId },
        actor: { userId: user.id },
        meta,
      });
      return { user, membershipId };
    });
  }

  /**
   * Which invitation and school a token belongs to, read before any tenant context through the
   * definer function (it discloses only id and tenant id). Null unless the school is ACTIVE.
   */
  private async locate(
    hash: Uint8Array<ArrayBuffer>,
  ): Promise<{ invitationId: string; tenant: School } | null> {
    const [ref] = await this.prisma.$queryRaw<{ id: string; tenant_id: string }[]>`
      SELECT id, tenant_id FROM invitation_by_token(${hash})`;
    if (!ref) return null;
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: ref.tenant_id, status: 'ACTIVE' },
      select: { id: true, code: true, name: true, status: true },
    });
    return tenant ? { invitationId: ref.id, tenant } : null;
  }

  /** The invitation behind a token if it is still open at an ACTIVE school, else null. */
  private async findOpen(token: string): Promise<OpenInvitation | null> {
    const hash = new Uint8Array(sha256(token));
    const located = await this.locate(hash);
    if (!located) return null;
    const { invitationId, tenant } = located;
    const now = new Date();
    return withTenant(this.prisma, tenant.id, async (tx) => {
      const invitation = await tx.invitation.findFirst({
        where: {
          id: invitationId,
          tokenHash: hash,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
      });
      if (!invitation) return null;
      const found = await tx.role.findMany({
        where: { id: { in: invitation.roleIds } },
        select: { id: true, name: true },
      });
      const roles = invitation.roleIds.flatMap((id) => found.find((r) => r.id === id) ?? []);
      return roles.length === 0 ? null : { invitation, tenant, roles };
    });
  }

  /** Queues the invitation email inside the transaction, so a queue outage rolls it back. */
  private async send(
    tx: Prisma.TransactionClient,
    auth: RequestAuth,
    row: InvitationRow,
    roles: { name: string }[],
    raw: string,
  ): Promise<string | null> {
    const school = await tx.tenant.findUniqueOrThrow({
      where: { id: auth.tenantId },
      select: { name: true },
    });
    const inviter = await tx.user.findUnique({
      where: { id: row.invitedBy },
      select: { name: true },
    });
    await this.email.enqueue(
      {
        to: row.email,
        ...invitationEmail({
          schoolName: school.name,
          inviterName: inviter?.name ?? school.name,
          roles: roles.map((r) => r.name),
          joinUrl: `${this.env.WEB_ORIGIN}/en/join?token=${raw}`,
          expiresAt: row.expiresAt,
        }),
      },
      { keepFailedSeconds: KEEP_FAILED_EMAIL_SECONDS },
    );
    return inviter?.name ?? null;
  }
}

/** Serialises invitation writes for one (school, email) until the transaction ends. */
async function lockEmail(
  tx: Prisma.TransactionClient,
  tenantId: string,
  email: string,
): Promise<void> {
  const key = `invitation:${tenantId}:${email.toLowerCase()}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/** The invitation in the current school (row-level security narrows the query), or 404. */
async function findInvitation(tx: Prisma.TransactionClient, id: string): Promise<InvitationRow> {
  const row = UUID.test(id)
    ? await tx.invitation.findUnique({ where: { id: id.toLowerCase() } })
    : null;
  if (!row) throw new NotFoundException('Invitation not found');
  return row;
}

/** Locks the row, then reads it afresh: what a parallel accept, re-send or revoke committed. */
async function lockInvitation(tx: Prisma.TransactionClient, id: string): Promise<InvitationRow> {
  await tx.$queryRaw`SELECT id FROM invitations WHERE id = ${id}::uuid FOR UPDATE`;
  return findInvitation(tx, id);
}

/**
 * Owner only from an owner (re-read now, not from the request's start); any other role only
 * within the inviter's own permissions.
 */
async function assertCanGrant(
  tx: Prisma.TransactionClient,
  auth: RequestAuth,
  roles: InvitedRole[],
): Promise<void> {
  if (
    roles.some((r) => r.key === OWNER_ROLE_KEY) &&
    !(auth.isOwner && (await isActiveOwner(tx, auth.tenantId, auth.userId)))
  ) {
    throw new PermissionDeniedException();
  }
  if (!canGrant(auth.permissions, roles.flatMap(permissionsOf))) {
    throw new PermissionDeniedException();
  }
}

/**
 * Joining replaces a DEACTIVATED seat's roles, so inviting a deactivated owner back would take
 * Owner away from them: only an owner may send that invitation (spec §16). 403 otherwise.
 */
async function assertMayReplaceOwnerSeat(
  tx: Prisma.TransactionClient,
  auth: RequestAuth,
  email: string,
): Promise<void> {
  const user = await tx.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return;
  const seat = await tx.membership.count({
    where: {
      tenantId: auth.tenantId,
      userId: user.id,
      status: 'DEACTIVATED',
      roles: { some: { role: { key: OWNER_ROLE_KEY } } },
    },
  });
  if (seat > 0 && !(auth.isOwner && (await isActiveOwner(tx, auth.tenantId, auth.userId)))) {
    throw new PermissionDeniedException();
  }
}

/** 409 `already-member` when the email belongs to an ACTIVE member of this school. */
async function assertNotMember(
  tx: Prisma.TransactionClient,
  tenantId: string,
  email: string,
): Promise<void> {
  const user = await tx.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return;
  const active = await tx.membership.count({
    where: { tenantId, userId: user.id, status: 'ACTIVE' },
  });
  if (active > 0) throw alreadyMember();
}

/** 409 `already-invited` when another open invitation exists for this email at this school. */
async function assertNotInvited(
  tx: Prisma.TransactionClient,
  tenantId: string,
  email: string,
  now: Date,
  exceptId?: string,
): Promise<void> {
  const open = await tx.invitation.count({
    where: {
      tenantId,
      email,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
  if (open > 0) {
    throw new ConflictException({
      type: 'already-invited',
      title: 'This person already has an invitation.',
      message: 'Re-send the open invitation instead.',
    });
  }
}

function alreadyMember(): ConflictException {
  return new ConflictException({
    type: 'already-member',
    title: 'This person is already a member.',
    message: 'This person is already a member of the school.',
  });
}

function unknownRoles(): BadRequestException {
  return new BadRequestException({
    message: 'One of the roles does not exist in this school.',
    errors: [{ path: 'roleIds', message: 'One of the roles does not exist in this school.' }],
  });
}

function toInvitation(
  row: InvitationRow,
  roles: { id: string; name: string }[],
  inviterName: string | null,
): Invitation {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    roles: roles.map((r) => ({ id: r.id, name: r.name })),
    expiresAt: row.expiresAt.toISOString(),
    invitedBy: inviterName,
    createdAt: row.createdAt.toISOString(),
  };
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? (error as { code?: unknown }).code
    : undefined;
}
