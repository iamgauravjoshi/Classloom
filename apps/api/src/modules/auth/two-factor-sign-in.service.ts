import type { AuthSession, TwoFactorChallenge, TwoFactorVerifyRequest } from '@classloom/contracts';
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { EmailService } from '../../core/email/email.service';
import { newDeviceEmail } from '../../core/email/templates/new-device';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { MembershipRole, TenantStatus, User } from '../../generated/prisma/client';
import { AuthEventsService } from './auth-events.service';
import { KnownDeviceService } from './known-device.service';
import { findActiveMembership } from './member-lookup';
import type { SignInMeta } from './password-sign-in.service';
import { CredentialsChangedError, SessionService } from './session.service';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorChallengeService } from './two-factor-challenge.service';

/** Failed new-device emails hold no secret; kept a day like the other security emails. */
const KEEP_FAILED_EMAIL_SECONDS = 86_400;

export const TWO_FACTOR_EXPIRED_TITLE = 'This sign-in has expired. Start again.';
export const TWO_FACTOR_INVALID_TITLE = "That code didn't work.";

/** Missing, used-up or no longer valid challenge: the client starts the sign-in again. */
export class TwoFactorExpiredException extends UnauthorizedException {
  constructor() {
    super({
      type: 'two-factor-expired',
      title: TWO_FACTOR_EXPIRED_TITLE,
      message: TWO_FACTOR_EXPIRED_TITLE,
    });
  }
}

export class TwoFactorInvalidException extends UnauthorizedException {
  constructor(attemptsLeft: number) {
    super({
      type: 'two-factor-invalid',
      title: TWO_FACTOR_INVALID_TITLE,
      message: TWO_FACTOR_INVALID_TITLE,
      attemptsLeft,
    });
  }
}

/** What a first factor (password or emailed code) proved. */
export interface FirstFactorResult {
  user: User;
  tenant: { id: string; code: string; name: string; status: TenantStatus };
  membership: { id: string; role: MembershipRole };
  remember: boolean;
  method: 'PASSWORD' | 'EMAIL_CODE';
}

export interface DeviceSignInMeta extends SignInMeta {
  /** The browser's `cl_device` token (existing or freshly minted). Never logged or stored raw. */
  deviceToken: string;
}

export interface SessionResult {
  token: string;
  session: AuthSession;
  remember: boolean;
}

export type FirstFactorOutcome =
  ({ kind: 'session' } & SessionResult) | { kind: 'challenge'; body: TwoFactorChallenge };

/**
 * The one place both first factors hand over to: decides between a session and the two-step
 * challenge, creates the session, records the device and sends the new-device email.
 */
@Injectable()
export class TwoFactorSignInService {
  private readonly logger = new Logger(TwoFactorSignInService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly events: AuthEventsService,
    private readonly devices: KnownDeviceService,
    private readonly challenges: TwoFactorChallengeService,
    private readonly twoFactor: TwoFactorService,
    private readonly email: EmailService,
  ) {}

  /**
   * After a correct first factor. Lets `CredentialsChangedError` through so each first factor
   * keeps answering a stale password with its own error.
   */
  async completeFirstFactor(
    first: FirstFactorResult,
    meta: DeviceSignInMeta,
  ): Promise<FirstFactorOutcome> {
    const { user, tenant, membership } = first;
    const now = new Date();
    // Read only: the device is recorded only once a session exists.
    const device = await this.devices.find(user.id, meta.deviceToken);
    if (isTwoFactorOn(user) && !this.devices.isTrusted(device, now)) {
      const { challenge, expiresAt } = await this.challenges.create({
        userId: user.id,
        tenantId: tenant.id,
        membershipId: membership.id,
        remember: first.remember,
        method: first.method,
        passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
      });
      return {
        kind: 'challenge',
        body: { twoFactorRequired: true, challenge, expiresAt: expiresAt.toISOString() },
      };
    }

    const { token, session } = await this.sessions.create({
      userId: user.id,
      tenantId: tenant.id,
      membershipId: membership.id,
      remember: first.remember,
      ip: meta.ip,
      userAgent: meta.userAgent,
      replacesToken: meta.currentToken,
      passwordChangedAt: user.passwordChangedAt,
    });
    await this.events.record({
      type: 'SIGN_IN_SUCCEEDED',
      method: first.method,
      userId: user.id,
      tenantId: tenant.id,
      sessionId: session.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.recordDevice(user, tenant, meta, { trust: false, sessionId: session.id }, now);
    return {
      kind: 'session',
      token,
      remember: session.remember,
      session: await this.sessions.toAuthSession({ session, tenant }, membership, user),
    };
  }

  /** `POST /auth/two-factor/verify`. */
  async verifyChallenge(
    input: TwoFactorVerifyRequest,
    meta: DeviceSignInMeta,
  ): Promise<SessionResult> {
    const now = new Date();
    const pending = await this.challenges.attempt(input.challenge);
    if (pending === 'expired') throw new TwoFactorExpiredException();

    // The user's current state decides: two-step turned off meanwhile ends the challenge.
    const user = await this.prisma.user.findUnique({ where: { id: pending.userId } });
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: pending.tenantId, status: 'ACTIVE' },
      select: { id: true, code: true, name: true, status: true },
    });
    const membership = tenant
      ? await findActiveMembership(this.prisma, tenant.id, pending.userId)
      : null;
    if (!user || !isTwoFactorOn(user) || !tenant || membership?.id !== pending.membershipId) {
      await this.challenges.discard(input.challenge);
      throw new TwoFactorExpiredException();
    }

    const eventBase = {
      userId: user.id,
      tenantId: tenant.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    };
    const matched = await this.twoFactor.verifyCodeWithLimit(user, input, now);
    if (!matched) {
      await this.events.record({
        type: 'TWO_FACTOR_FAILED',
        method: input.recoveryCode !== undefined ? 'RECOVERY_CODE' : pending.method,
        ...eventBase,
      });
      if (pending.attemptsLeft <= 0) await this.challenges.discard(input.challenge);
      throw new TwoFactorInvalidException(pending.attemptsLeft);
    }

    // Single use: of two parallel right answers only one gets the session.
    if (!(await this.challenges.consume(input.challenge))) throw new TwoFactorExpiredException();

    let created: Awaited<ReturnType<SessionService['create']>>;
    try {
      created = await this.sessions.create({
        userId: user.id,
        tenantId: tenant.id,
        membershipId: membership.id,
        remember: pending.remember,
        ip: meta.ip,
        userAgent: meta.userAgent,
        replacesToken: meta.currentToken,
        // The value read at the first factor, so a password change since then refuses.
        passwordChangedAt: pending.passwordChangedAt ? new Date(pending.passwordChangedAt) : null,
      });
    } catch (error) {
      if (error instanceof CredentialsChangedError) throw new TwoFactorExpiredException();
      throw error;
    }
    const { token, session } = created;
    const withSession = { ...eventBase, sessionId: session.id };
    await this.events.record({ type: 'SIGN_IN_SUCCEEDED', method: pending.method, ...withSession });
    await this.events.record(
      matched === 'RECOVERY'
        ? { type: 'RECOVERY_CODE_USED', method: 'RECOVERY_CODE', ...withSession }
        : { type: 'TWO_FACTOR_SUCCEEDED', method: pending.method, ...withSession },
    );
    await this.recordDevice(
      user,
      tenant,
      meta,
      { trust: input.trustDevice, sessionId: session.id },
      now,
    );
    return {
      token,
      remember: session.remember,
      session: await this.sessions.toAuthSession({ session, tenant }, membership, user),
    };
  }

  /**
   * Only after a session exists: upsert the device, trust it if asked, and email on first sight.
   * Never fails the sign-in: the session is already made.
   */
  private async recordDevice(
    user: User,
    tenant: { id: string; name: string },
    meta: DeviceSignInMeta,
    opts: { trust: boolean; sessionId: string },
    now: Date,
  ): Promise<void> {
    try {
      const { device, isNew } = await this.devices.recordSignIn(
        user.id,
        meta.deviceToken,
        meta.userAgent ?? null,
        { trust: opts.trust },
        now,
      );
      if (opts.trust) {
        await this.events.record({
          type: 'DEVICE_TRUSTED',
          userId: user.id,
          tenantId: tenant.id,
          sessionId: opts.sessionId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }
      if (!isNew) return;
      await this.email.enqueue(
        {
          to: user.email,
          ...newDeviceEmail({
            schoolName: tenant.name,
            device: device.label,
            ip: meta.ip,
            at: now,
            securityUrl: `${this.env.WEB_ORIGIN}/en/account/security`,
          }),
        },
        { keepFailedSeconds: KEEP_FAILED_EMAIL_SECONDS },
      );
    } catch (error) {
      this.logger.warn(`Device not recorded or new-device email not queued: ${String(error)}`);
    }
  }
}

const isTwoFactorOn = (user: Pick<User, 'totpSecretEnc' | 'totpEnabledAt'>): boolean =>
  user.totpSecretEnc !== null && user.totpEnabledAt !== null;
