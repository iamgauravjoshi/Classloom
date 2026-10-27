import type { ForgotPasswordRequest, ResetPasswordRequest } from '@classloom/contracts';
import {
  GoneException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { EmailService } from '../../core/email/email.service';
import { passwordResetEmail } from '../../core/email/templates/password-reset';
import { PrismaService } from '../../core/prisma/prisma.service';
import { QueueProducer } from '../../core/queue/queue.module';
import { RedisService } from '../../core/redis/redis.service';
import { AuthEventsService } from './auth-events.service';
import { randomToken, sha256 } from './crypto';
import { AUTH_QUEUE } from './email-code.service';
import { findUserByIdentifier, findUserSchools } from './member-lookup';
import { PasswordService } from './password.service';
import { checkPasswordPolicy } from './password-policy';
import { policyErrors } from './policy-errors';
import { SessionService } from './session.service';

export const SEND_RESET_JOB = 'send-reset';

export const RESET_GONE_TITLE = 'This reset link has expired or was already used.';
export const RESET_MINUTES = 30;
const RESET_TTL_SECONDS = RESET_MINUTES * 60;
const MAX_LINKS_PER_HOUR = 3;
const TOKEN_PREFIX = 'auth:reset:';

export interface SendResetJobData {
  identifier: string;
}

export interface ResetMeta {
  ip?: string;
  userAgent?: string;
}

/** One response for every kind of unknown, expired or used link. */
export class ResetLinkGoneException extends GoneException {
  constructor() {
    super({ title: RESET_GONE_TITLE, message: RESET_GONE_TITLE });
  }
}

/**
 * One atomic step: counts this request against the hour's limit (returns 0 when it is over),
 * drops the user's previous token, and stores the new one under both keys. Only the newest
 * link can work, even when requests run in parallel. KEYS: sent counter, user -> token pointer,
 * new token. ARGV: limit, counter expiry, user id, new hash, token expiry, token key prefix.
 */
const ISSUE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
if count > tonumber(ARGV[1]) then return 0 end
local old = redis.call('GET', KEYS[2])
if old then redis.call('DEL', ARGV[6] .. old) end
redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[5])
redis.call('SET', KEYS[2], ARGV[4], 'EX', ARGV[5])
return 1
`;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly producer: QueueProducer,
    private readonly email: EmailService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly events: AuthEventsService,
  ) {}

  private tokenKey = (hash: string) => `${TOKEN_PREFIX}${hash}`;
  private userKey = (userId: string) => `auth:reset-user:${userId}`;
  private sentKey = (userId: string) => `auth:reset-sent:${userId}`;

  /**
   * Enqueues the work and answers at once, so the response never depends on whether the account
   * exists. Fails fast with 503 when the queue cannot be reached.
   */
  async request(input: ForgotPasswordRequest): Promise<void> {
    const data: SendResetJobData = { identifier: input.identifier };
    try {
      await this.producer.add(AUTH_QUEUE, SEND_RESET_JOB, data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        // The data holds no token (only what the person typed), so it can be kept briefly.
        removeOnComplete: { age: 300 },
        removeOnFail: { age: 3600 },
      });
    } catch (error) {
      this.logger.warn(`Password reset not queued: ${String(error)}`);
      throw new ServiceUnavailableException({
        title: 'Service temporarily unavailable.',
        message: 'We could not send a reset link right now. Try again in a moment.',
      });
    }
  }

  /** Runs in the `auth.send-reset` job. Does nothing unless every condition holds. */
  async processSend(data: SendResetJobData): Promise<void> {
    const user = await findUserByIdentifier(this.prisma, data.identifier);
    if (!user) return;
    const schools = await findUserSchools(this.prisma, user.id);
    if (!schools.some((school) => school.eligible)) return;

    // The raw token lives only in this function and the email.
    const token = randomToken();
    const hash = sha256(token).toString('hex');
    const sentKey = this.sentKey(user.id);
    const issued = await this.redis.client.eval(
      ISSUE_SCRIPT,
      3,
      sentKey,
      this.userKey(user.id),
      this.tokenKey(hash),
      MAX_LINKS_PER_HOUR,
      3600,
      user.id,
      hash,
      RESET_TTL_SECONDS,
      TOKEN_PREFIX,
    );
    if (issued !== 1) return;

    try {
      await this.email.enqueue(
        {
          to: user.email,
          ...passwordResetEmail({
            link: `${this.env.WEB_ORIGIN}/en/reset-password?token=${token}`,
            minutes: RESET_MINUTES,
          }),
        },
        // The job data holds the live link, so a failed job must not outlive it.
        { keepFailedSeconds: RESET_TTL_SECONDS },
      );
    } catch (error) {
      // Give the send back so the job's retry is not counted as a second link.
      await this.redis.client.decr(sentKey).catch(() => undefined);
      throw error;
    }
    await this.events.record({ type: 'PASSWORD_RESET_REQUESTED', userId: user.id });
  }

  async reset(input: ResetPasswordRequest, meta: ResetMeta = {}): Promise<void> {
    const key = this.tokenKey(sha256(input.token).toString('hex'));

    // Peek first, so a refused password does not spend the link; unknown links cost no hashing.
    const userId = await this.redisCall(() => this.redis.client.get(key));
    if (!userId) throw new ResetLinkGoneException();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ResetLinkGoneException();

    const schools = await findUserSchools(this.prisma, user.id);
    const issues = checkPasswordPolicy(input.newPassword, {
      email: user.email,
      schoolCodes: schools.map((school) => school.code),
    });
    if (issues.length > 0) throw policyErrors(issues);

    const passwordHash = await this.passwords.hash(input.newPassword);

    // Single use: only the caller whose GETDEL returns the user may go on.
    const consumed = await this.redisCall(() => this.redis.client.getdel(key));
    if (consumed !== user.id) throw new ResetLinkGoneException();

    await this.sessions.changePassword(user.id, {
      passwordHash,
      reason: 'PASSWORD_RESET',
      verifyEmail: true,
    });
    await this.events.record({
      type: 'PASSWORD_RESET',
      method: 'RESET_LINK',
      userId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  private async redisCall<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.warn(`Reset link check failed, Redis unavailable: ${String(error)}`);
      throw new ServiceUnavailableException({
        title: 'Service temporarily unavailable.',
        message: 'We could not check the link right now. Try again in a moment.',
      });
    }
  }
}
