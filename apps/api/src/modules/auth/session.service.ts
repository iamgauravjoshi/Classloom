import type { AuthSession } from '@classloom/contracts';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import type {
  MembershipRole,
  Session,
  SessionRevokedReason,
  TenantStatus,
} from '../../generated/prisma/client';
import { randomToken, sha256 } from './crypto';
import { initialExpiry, isExpired, slidExpiry } from './session-expiry';

const MAX_USER_AGENT_LENGTH = 512;

/** Prisma's Bytes type wants a Uint8Array over a plain ArrayBuffer, which a Buffer is not. */
const tokenHash = (token: string): Uint8Array<ArrayBuffer> => new Uint8Array(sha256(token));

export interface CreateSessionInput {
  userId: string;
  tenantId: string;
  membershipId: string;
  remember: boolean;
  ip?: string;
  userAgent?: string;
  /** The raw token of the session this sign-in replaces; it is revoked with `REPLACED`. */
  replacesToken?: string;
}

export interface ResolvedSession {
  session: Session;
  tenant: { id: string; code: string; name: string; status: TenantStatus };
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every sign-in gets a fresh token (no fixation); only its SHA-256 is stored. */
  async create(input: CreateSessionInput): Promise<{ token: string; session: Session }> {
    const token = randomToken();
    const now = new Date();
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: {
          tokenHash: tokenHash(token),
          userId: input.userId,
          tenantId: input.tenantId,
          membershipId: input.membershipId,
          remember: input.remember,
          authenticatedAt: now,
          lastSeenAt: now,
          ...initialExpiry(now, input.remember),
          ip: input.ip ?? null,
          userAgent: input.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
        },
      });
      if (input.replacesToken) {
        await tx.session.updateMany({
          where: { tokenHash: tokenHash(input.replacesToken), revokedAt: null },
          data: { revokedAt: now, revokedReason: 'REPLACED' },
        });
      }
      return created;
    });
    return { token, session };
  }

  /** One query on the platform-level tables; null unless the session is live and the school ACTIVE. */
  async resolve(token: string, now = new Date()): Promise<ResolvedSession | null> {
    const row = await this.prisma.session.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { tenant: { select: { id: true, code: true, name: true, status: true } } },
    });
    if (!row || row.revokedAt || isExpired(row, now) || row.tenant.status !== 'ACTIVE') {
      return null;
    }
    const { tenant, ...session } = row;
    return { session, tenant };
  }

  /**
   * Slides the expiry and `last_seen_at`, at most once every 5 minutes. `cookieRefresh` tells the
   * caller to re-issue the persistent cookie (remembered sessions only; the cookie of a session
   * that is not remembered has no lifetime of its own).
   */
  async touch(session: Session, now = new Date()): Promise<{ cookieRefresh: boolean }> {
    const slid = slidExpiry(session, now);
    if (!slid) return { cookieRefresh: false };
    await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { lastSeenAt: now, ...slid },
    });
    return { cookieRefresh: session.remember };
  }

  async revoke(sessionId: string, reason: SessionRevokedReason): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllForUser(
    userId: string,
    reason: SessionRevokedReason,
    exceptSessionId?: string,
  ): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async toAuthSession(
    resolved: ResolvedSession,
    membership: { role: MembershipRole },
    user: {
      id: string;
      name: string;
      email: string;
      mobile: string | null;
      passwordHash: string | null;
    },
  ): Promise<AuthSession> {
    const { session, tenant } = resolved;
    const campus = await withTenant(this.prisma, tenant.id, (tx) =>
      tx.campus.findFirstOrThrow({
        where: { tenantId: tenant.id, isPrimary: true },
        select: { id: true, name: true },
      }),
    );
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        hasPassword: user.passwordHash !== null,
      },
      school: { id: tenant.id, code: tenant.code.toUpperCase(), name: tenant.name },
      campus: { id: campus.id, name: campus.name },
      role: membership.role,
      remember: session.remember,
      expiresAt: session.expiresAt.toISOString(),
    };
  }
}
