import type { PasswordSignInRequest } from '@classloom/contracts';
import { parseIdentifier } from '@classloom/utils';
import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';

import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthEventsService } from './auth-events.service';
import { findActiveMembership, findActiveTenant } from './member-lookup';
import { PasswordService } from './password.service';
import { CredentialsChangedError } from './session.service';
import { PAUSE_SECONDS, SignInPauseService } from './sign-in-pause.service';
import {
  type DeviceSignInMeta,
  type FirstFactorOutcome,
  TwoFactorSignInService,
} from './two-factor-sign-in.service';

export const INVALID_CREDENTIALS_TITLE = 'Email/mobile or password is incorrect.';

/** One response for every kind of wrong credentials, so nothing reveals which part was wrong. */
export class InvalidCredentialsException extends UnauthorizedException {
  constructor() {
    super({ title: INVALID_CREDENTIALS_TITLE, message: INVALID_CREDENTIALS_TITLE });
  }
}

export class SignInPausedException extends HttpException {
  constructor(retryAfter: number) {
    super(
      {
        type: 'sign-in-paused',
        title: 'Too many attempts.',
        message: 'Too many attempts. Try again later, or sign in with an email code.',
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export interface SignInMeta {
  ip?: string;
  userAgent?: string;
  /** The raw token of the session cookie the request carried; revoked with `REPLACED`. */
  currentToken?: string;
}

@Injectable()
export class PasswordSignInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly events: AuthEventsService,
    private readonly pauses: SignInPauseService,
    private readonly twoFactorSignIn: TwoFactorSignInService,
  ) {}

  async signIn(input: PasswordSignInRequest, meta: DeviceSignInMeta): Promise<FirstFactorOutcome> {
    const eventBase = { method: 'PASSWORD', ip: meta.ip, userAgent: meta.userAgent } as const;

    const tenant = await findActiveTenant(this.prisma, input.schoolCode);
    if (!tenant) {
      await this.passwords.verifyDummy(input.password);
      await this.events.record({ type: 'SIGN_IN_FAILED', ...eventBase });
      throw new InvalidCredentialsException();
    }

    // Counted before the password is checked, so parallel guesses cannot exceed the limit.
    const { blockedFor, attempt } = await this.pauses.reserveAttempt(tenant.id, input.identifier);
    if (blockedFor !== null) throw new SignInPausedException(blockedFor);

    const user = await this.findUser(input.identifier);
    // Also runs for an unknown identifier, so a known user pays for no extra transaction.
    const membership = await findActiveMembership(this.prisma, tenant.id, user?.id);

    const hash = user?.passwordHash;
    // Every failure path runs one argon2 verification, so they all take the same time.
    const ok =
      user && membership && hash
        ? await this.passwords.verify(hash, input.password)
        : await this.passwords.verifyDummy(input.password);

    if (!ok || !user || !membership) {
      const { paused, started } = await this.pauses.recordFailure(
        tenant.id,
        input.identifier,
        attempt,
      );
      // Only the request that set the pause records it, so it is logged once.
      if (!paused || started) {
        await this.events.record({
          type: paused ? 'SIGN_IN_PAUSED' : 'SIGN_IN_FAILED',
          userId: user?.id,
          tenantId: tenant.id,
          ...eventBase,
        });
      }
      if (paused) {
        throw new SignInPausedException(
          (await this.pauses.isPaused(tenant.id, input.identifier)) ?? PAUSE_SECONDS,
        );
      }
      throw new InvalidCredentialsException();
    }

    // A concurrent flood may have used up the window or set the pause since this attempt began.
    if (!(await this.pauses.allowsSuccess(tenant.id, input.identifier))) {
      throw new SignInPausedException(
        (await this.pauses.isPaused(tenant.id, input.identifier)) ?? PAUSE_SECONDS,
      );
    }
    await this.pauses.clear(tenant.id, input.identifier);
    let passwordHash = user.passwordHash;
    if (hash && this.passwords.needsRehash(hash)) {
      passwordHash = await this.passwords.hash(input.password);
      // Only over the hash just verified, so a reset that landed meanwhile is never overwritten.
      await this.prisma.user.updateMany({
        where: { id: user.id, passwordHash: hash },
        data: { passwordHash },
      });
    }

    try {
      // Either a session or, with two-step on, the challenge; the stale-password check stays here.
      return await this.twoFactorSignIn.completeFirstFactor(
        {
          user: { ...user, passwordHash },
          tenant,
          membership,
          remember: input.remember,
          method: 'PASSWORD',
        },
        meta,
      );
    } catch (error) {
      if (error instanceof CredentialsChangedError) throw new InvalidCredentialsException();
      throw error;
    }
  }

  private findUser(identifier: string) {
    const parsed = parseIdentifier(identifier);
    if (parsed.kind === 'email') {
      return this.prisma.user.findUnique({ where: { email: parsed.value } });
    }
    if (parsed.kind === 'mobile') {
      return this.prisma.user.findFirst({ where: { mobile: parsed.value } });
    }
    return Promise.resolve(null);
  }
}
