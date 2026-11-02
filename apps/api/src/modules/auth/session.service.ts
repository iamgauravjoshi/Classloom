import type { AuthSession } from '@classloom/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { EmailService } from '../../core/email/email.service';
import { passwordChangedEmail } from '../../core/email/templates/password-changed';
import { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import type { Session, SessionRevokedReason, TenantStatus } from '../../generated/prisma/client';
import type { MemberAccess } from '../iam/permissions';
import { MAX_USER_AGENT_LENGTH } from './auth-events.service';
import { randomToken, sha256 } from './crypto';
import { KnownDeviceService } from './known-device.service';
import { initialExpiry, isExpired, slidExpiry } from './session-expiry';

const DAY = 86_400_000;
/** The password-changed email holds no secret; a failed job is kept a day like the other notices. */
const KEEP_FAILED_EMAIL_SECONDS = 86_400;

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
  /**
   * The user's `password_changed_at` as read when the credentials were checked. The session is
   * refused if it has changed since, so a sign-in in flight cannot outlive a reset or change.
   */
  passwordChangedAt?: Date | null;
}

/** The password was set, changed or reset while this sign-in was in flight. */
export class CredentialsChangedError extends Error {
  constructor() {
    super('Password changed during sign-in');
  }
}

export interface ResolvedSession {
  session: Session;
  tenant: { id: string; code: string; name: string; status: TenantStatus };
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly knownDevices: KnownDeviceService,
    private readonly email: EmailService,
  ) {}

  /** Every sign-in gets a fresh token (no fixation); only its SHA-256 is stored. */
  async create(input: CreateSessionInput): Promise<{ token: string; session: Session }> {
    const token = randomToken();
    const now = new Date();
    const session = await this.prisma.$transaction(async (tx) => {
      // FOR SHARE blocks `changePassword` until this commits, so its revoke then sees the new
      // session; a change that committed first shows here as a different timestamp.
      if (input.passwordChangedAt !== undefined) {
        const [current] = await tx.$queryRaw<{ password_changed_at: Date | null }[]>`
          SELECT password_changed_at FROM users WHERE id = ${input.userId}::uuid FOR SHARE`;
        if (current?.password_changed_at?.getTime() !== input.passwordChangedAt?.getTime()) {
          throw new CredentialsChangedError();
        }
      }
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
   * Slides the expiry and `last_seen_at`, at most once every 5 minutes. `cookieRefresh` asks the
   * caller to re-send the persistent cookie, about once a day: only for a remembered session,
   * only when a live row was actually updated, and only when this touch crosses into a new
   * 24-hour period since sign-in. No stored field records when the cookie was last issued
   * (`expires_at` moves on every slide), so the period is derived from `authenticated_at` and the
   * previous `last_seen_at`.
   */
  async touch(session: Session, now = new Date()): Promise<{ cookieRefresh: boolean }> {
    const slid = slidExpiry(session, now);
    if (!slid) return { cookieRefresh: false };
    const { count } = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { lastSeenAt: now, ...slid },
    });
    if (count === 0 || !session.remember) return { cookieRefresh: false };
    const period = (at: Date) =>
      Math.floor((at.getTime() - session.authenticatedAt.getTime()) / DAY);
    return { cookieRefresh: period(now) > period(session.lastSeenAt) };
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

  /**
   * Stores a new password and revokes the user's sessions in ONE transaction, so the password can
   * never change while an old session survives. `exceptSessionId` keeps the caller's own session;
   * `verifyEmail` also stamps `email_verified_at` when it is still empty (a reset link proves it).
   * Once committed, the "password changed" email is queued; a queue failure is logged, never thrown,
   * because the change has already happened.
   */
  async changePassword(
    userId: string,
    input: {
      passwordHash: string;
      reason: SessionRevokedReason;
      exceptSessionId?: string;
      verifyEmail?: boolean;
    },
  ): Promise<void> {
    const now = new Date();
    const email = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { passwordHash: input.passwordHash, passwordChangedAt: now },
        select: { email: true },
      });
      if (input.verifyEmail) {
        await tx.user.updateMany({
          where: { id: userId, emailVerifiedAt: null },
          data: { emailVerifiedAt: now },
        });
      }
      await tx.session.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(input.exceptSessionId ? { id: { not: input.exceptSessionId } } : {}),
        },
        data: { revokedAt: now, revokedReason: input.reason },
      });
      // A new password ends "trust this device": the next sign-in asks for the app code again.
      await this.knownDevices.clearTrustForUser(userId, tx);
      return user.email;
    });
    try {
      await this.email.enqueue(
        {
          to: email,
          ...passwordChangedEmail({
            at: now,
            forgotUrl: `${this.env.WEB_ORIGIN}/en/forgot-password`,
          }),
        },
        { keepFailedSeconds: KEEP_FAILED_EMAIL_SECONDS },
      );
    } catch (error) {
      this.logger.warn(`Password-changed email not queued: ${String(error)}`);
    }
  }

  /**
   * The contract session. `access` is the member's roles and effective permissions as loaded
   * for this request or sign-in (`request.auth` or `findActiveMembership`).
   */
  async toAuthSession(
    resolved: ResolvedSession,
    access: Pick<MemberAccess, 'roles' | 'permissions'>,
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
      roles: access.roles.map((role) => ({ key: role.key, name: role.name })),
      // Catalogue order (MemberAccess builds the set in that order).
      permissions: [...access.permissions],
      // Set from the session once required two-step sign-in lands (spec §10).
      twoFactorSetupRequired: false,
      remember: session.remember,
      expiresAt: session.expiresAt.toISOString(),
    };
  }
}
