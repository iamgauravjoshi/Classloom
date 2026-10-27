import type { AuthSession, PasswordSignInRequest } from '@classloom/contracts';
import { parseIdentifier } from '@classloom/utils';
import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';

import { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import { AuthEventsService } from './auth-events.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { PAUSE_SECONDS, SignInPauseService } from './sign-in-pause.service';

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
    private readonly sessions: SessionService,
    private readonly events: AuthEventsService,
    private readonly pauses: SignInPauseService,
  ) {}

  async signIn(
    input: PasswordSignInRequest,
    meta: SignInMeta = {},
  ): Promise<{ token: string; session: AuthSession; remember: boolean }> {
    const eventBase = { method: 'PASSWORD', ip: meta.ip, userAgent: meta.userAgent } as const;

    const tenant = await this.prisma.tenant.findFirst({
      where: { code: input.schoolCode, status: 'ACTIVE' },
      select: { id: true, code: true, name: true, status: true },
    });
    if (!tenant) {
      await this.passwords.verifyDummy(input.password);
      await this.events.record({ type: 'SIGN_IN_FAILED', ...eventBase });
      throw new InvalidCredentialsException();
    }

    const secondsLeft = await this.pauses.isPaused(tenant.id, input.identifier);
    if (secondsLeft !== null) throw new SignInPausedException(secondsLeft);

    const user = await this.findUser(input.identifier);
    const membership = user
      ? await withTenant(this.prisma, tenant.id, (tx) =>
          tx.membership.findFirst({
            where: { tenantId: tenant.id, userId: user.id, status: 'ACTIVE' },
            select: { id: true, role: true },
          }),
        )
      : null;

    const hash = user?.passwordHash;
    // Every failure path runs one argon2 verification, so they all take the same time.
    const ok =
      user && membership && hash
        ? await this.passwords.verify(hash, input.password)
        : await this.passwords.verifyDummy(input.password);

    if (!ok || !user || !membership) {
      const { paused } = await this.pauses.recordFailure(tenant.id, input.identifier);
      await this.events.record({
        type: paused ? 'SIGN_IN_PAUSED' : 'SIGN_IN_FAILED',
        userId: user?.id,
        tenantId: tenant.id,
        ...eventBase,
      });
      if (paused) {
        throw new SignInPausedException(
          (await this.pauses.isPaused(tenant.id, input.identifier)) ?? PAUSE_SECONDS,
        );
      }
      throw new InvalidCredentialsException();
    }

    await this.pauses.clear(tenant.id, input.identifier);
    let passwordHash = user.passwordHash;
    if (hash && this.passwords.needsRehash(hash)) {
      passwordHash = await this.passwords.hash(input.password);
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    }

    const { token, session } = await this.sessions.create({
      userId: user.id,
      tenantId: tenant.id,
      membershipId: membership.id,
      remember: input.remember,
      ip: meta.ip,
      userAgent: meta.userAgent,
      replacesToken: meta.currentToken,
    });
    await this.events.record({
      type: 'SIGN_IN_SUCCEEDED',
      userId: user.id,
      tenantId: tenant.id,
      sessionId: session.id,
      ...eventBase,
    });
    return {
      token,
      remember: session.remember,
      session: await this.sessions.toAuthSession({ session, tenant }, membership, {
        ...user,
        passwordHash,
      }),
    };
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
