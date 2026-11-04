import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../generated/prisma/client';

export const MAX_AUDIT_USER_AGENT_LENGTH = 512;

/**
 * The actions the `audit_events` CHECK constraint admits (IAM spec §6; onboarding spec §4, widened
 * by the school_onboarding migration). Keep the two lists identical.
 */
export type AuditAction =
  | 'role.created'
  | 'role.updated'
  | 'role.deleted'
  | 'role.permissions_changed'
  | 'member.invited'
  | 'member.invite_revoked'
  | 'member.joined'
  | 'member.roles_changed'
  | 'member.deactivated'
  | 'member.reactivated'
  | 'member.two_factor_reset'
  | 'school.profile_updated'
  | 'school.logo_changed'
  | 'school.logo_removed'
  | 'academic_year.created'
  | 'academic_year.updated'
  | 'academic_year.made_current'
  | 'academic_year.deleted'
  | 'campus.created'
  | 'campus.updated'
  | 'campus.deactivated'
  | 'campus.reactivated'
  | 'campus.made_primary';

export type AuditTargetType =
  'role' | 'membership' | 'invitation' | 'school' | 'academic_year' | 'campus';

export interface AuditInput {
  /** The school the change happened in: the actor's school, or the invited one for the system. */
  tenantId: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  /** Changed fields only. */
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  /** Null for the system and the CLI; the joining person themselves for `member.joined`. */
  actor: { userId: string | null } | null;
  meta: { ip?: string; userAgent?: string };
}

/** The append-only trail of IAM changes (spec §6). */
@Injectable()
export class AuditService {
  /**
   * Writes one audit row. Call it inside the transaction that makes the change (`tx` from
   * `withTenant`), so the row exists exactly when the change does.
   */
  async record(tx: Pick<Prisma.TransactionClient, 'auditEvent'>, input: AuditInput): Promise<void> {
    await tx.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actor?.userId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        before: input.before ?? undefined,
        after: input.after ?? undefined,
        ip: input.meta.ip ?? null,
        userAgent: input.meta.userAgent?.slice(0, MAX_AUDIT_USER_AGENT_LENGTH) ?? null,
      },
    });
  }
}
