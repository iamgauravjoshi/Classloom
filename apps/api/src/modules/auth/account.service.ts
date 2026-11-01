import type { Me, SetPasswordRequest, UpdateMeRequest } from '@classloom/contracts';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import type { User } from '../../generated/prisma/client';
import { AuthEventsService } from './auth-events.service';
import { findUserSchools } from './member-lookup';
import { PasswordService } from './password.service';
import { checkPasswordPolicy } from './password-policy';
import { SignInPausedException } from './password-sign-in.service';
import { policyErrors } from './policy-errors';
import type { RequestAuth } from './request-auth';
import { SessionService } from './session.service';
import { PAUSE_SECONDS, SignInPauseService } from './sign-in-pause.service';

export const RECENT_SIGN_IN_MINUTES = 10;
export const MAX_PROFILE_CHANGES_PER_HOUR = 20;
const CHANGES_WINDOW_SECONDS = 3600;
const MOBILE_TAKEN = 'This mobile number is already used by another account.';

export interface AccountMeta {
  ip?: string;
  userAgent?: string;
}

/** The sign-in is too old to set a first password; the web page sends the person through the email code again. */
export class RecentSignInRequiredException extends ForbiddenException {
  constructor() {
    super({
      type: 'recent-sign-in-required',
      title: 'Sign in again to continue.',
      message: 'Sign in again with an email code, then set your password.',
    });
  }
}

/** Atomic: counts a change and returns {count, seconds left}. KEYS[1] counter. ARGV[1] window. */
const COUNT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {c, math.max(redis.call('TTL', KEYS[1]), 1)}
`;

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly events: AuthEventsService,
    private readonly pauses: SignInPauseService,
  ) {}

  async getMe(auth: RequestAuth): Promise<Me> {
    return toMe(await this.user(auth.userId));
  }

  async updateMe(auth: RequestAuth, input: UpdateMeRequest): Promise<Me> {
    const data: { name?: string; mobile?: string | null } = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.mobile !== undefined) data.mobile = input.mobile;
    // Only a real change attempt counts, so reading back the form never uses up the hour.
    if (Object.keys(data).length === 0) return this.getMe(auth);
    await this.countChange(auth.userId);

    try {
      return toMe(await this.prisma.user.update({ where: { id: auth.userId }, data }));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          message: MOBILE_TAKEN,
          errors: [{ path: 'mobile', message: MOBILE_TAKEN }],
        });
      }
      throw error;
    }
  }

  async setPassword(
    auth: RequestAuth,
    input: SetPasswordRequest,
    meta: AccountMeta = {},
  ): Promise<void> {
    const user = await this.user(auth.userId);
    const hadPassword = user.passwordHash !== null;

    if (!hadPassword && !isRecent(auth.authenticatedAt)) throw new RecentSignInRequiredException();

    const schools = await findUserSchools(this.prisma, user.id);
    const issues = checkPasswordPolicy(input.newPassword, {
      email: user.email,
      schoolCodes: schools.map((school) => school.code),
    });
    if (issues.length > 0) throw policyErrors(issues);

    if (user.passwordHash) {
      await this.checkCurrentPassword(auth, user, user.passwordHash, input.currentPassword);
    }

    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.sessions.changePassword(user.id, {
      passwordHash,
      reason: 'PASSWORD_CHANGED',
      exceptSessionId: auth.sessionId,
    });
    await this.events.record({
      type: hadPassword ? 'PASSWORD_CHANGED' : 'PASSWORD_SET',
      userId: user.id,
      tenantId: auth.tenantId,
      sessionId: auth.sessionId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /** A wrong current password counts towards the pause for this email at the session's school. */
  private async checkCurrentPassword(
    auth: RequestAuth,
    user: User,
    passwordHash: string,
    currentPassword: string | undefined,
  ): Promise<void> {
    if (!currentPassword) throw currentPasswordError('Enter your current password.');

    const { blockedFor, attempt } = await this.pauses.reserveAttempt(auth.tenantId, user.email);
    if (blockedFor !== null) throw new SignInPausedException(blockedFor);

    if (!(await this.passwords.verify(passwordHash, currentPassword))) {
      const { paused, started } = await this.pauses.recordFailure(
        auth.tenantId,
        user.email,
        attempt,
      );
      if (started) {
        await this.events.record({
          type: 'SIGN_IN_PAUSED',
          userId: user.id,
          tenantId: auth.tenantId,
          sessionId: auth.sessionId,
        });
      }
      if (paused) {
        throw new SignInPausedException(
          (await this.pauses.isPaused(auth.tenantId, user.email)) ?? PAUSE_SECONDS,
        );
      }
      throw currentPasswordError('Your current password is incorrect.');
    }
    if (!(await this.pauses.allowsSuccess(auth.tenantId, user.email))) {
      throw new SignInPausedException(
        (await this.pauses.isPaused(auth.tenantId, user.email)) ?? PAUSE_SECONDS,
      );
    }
    await this.pauses.clear(auth.tenantId, user.email);
  }

  /** 20 changes per hour per user. Redis errors fail open, like the sign-in pause. */
  private async countChange(userId: string): Promise<void> {
    let count: number;
    let retryAfter: number;
    try {
      [count, retryAfter] = (await this.redis.client.eval(
        COUNT_SCRIPT,
        1,
        `auth:me-changes:${userId}`,
        CHANGES_WINDOW_SECONDS,
      )) as [number, number];
    } catch (error) {
      this.logger.warn(`Profile change not counted, Redis unavailable: ${String(error)}`);
      return;
    }
    if (count > MAX_PROFILE_CHANGES_PER_HOUR) {
      throw new HttpException(
        {
          title: 'Too many changes.',
          message: 'Too many changes to your profile. Try again later.',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async user(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException();
    return user;
  }
}

const toMe = (user: User): Me => ({
  id: user.id,
  name: user.name,
  email: user.email,
  emailVerified: user.emailVerifiedAt !== null,
  mobile: user.mobile,
  hasPassword: user.passwordHash !== null,
});

export const isRecent = (authenticatedAt: Date, now = Date.now()) =>
  now - authenticatedAt.getTime() <= RECENT_SIGN_IN_MINUTES * 60_000;

function currentPasswordError(message: string): BadRequestException {
  return new BadRequestException({
    title: 'Bad Request',
    message: 'Validation failed',
    errors: [{ path: 'currentPassword', message }],
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}
