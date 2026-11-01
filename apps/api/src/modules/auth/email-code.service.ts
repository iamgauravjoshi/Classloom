import { randomInt, timingSafeEqual } from 'node:crypto';

import type {
  AuthSession,
  CodeRequest,
  CodeRequestAccepted,
  CodeVerifyRequest,
} from '@classloom/contracts';
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { EmailService } from '../../core/email/email.service';
import { signInCodeEmail } from '../../core/email/templates/sign-in-code';
import { PrismaService } from '../../core/prisma/prisma.service';
import { QueueProducer } from '../../core/queue/queue.module';
import { RedisService } from '../../core/redis/redis.service';
import { maskEmail } from '../tenancy/mask-email';
import { AuthEventsService } from './auth-events.service';
import { hmac } from './crypto';
import { findActiveMembership, findActiveTenant } from './member-lookup';
import type { SignInMeta } from './password-sign-in.service';
import { CredentialsChangedError, SessionService } from './session.service';

export const AUTH_QUEUE = 'auth';
export const SEND_CODE_JOB = 'send-code';

export const INVALID_CODE_TITLE = 'That code is incorrect or has expired.';
export const CODE_MINUTES = 10;
const CODE_TTL_SECONDS = CODE_MINUTES * 60;
const MAX_TRIES = 5;
const MIN_SECONDS_BETWEEN_SENDS = 60;
const MAX_SENDS_PER_HOUR = 5;

export interface SendCodeJobData {
  schoolCode: string;
  email: string;
}

/** One response for every kind of wrong or expired code. */
export class InvalidCodeException extends UnauthorizedException {
  constructor() {
    super({ title: INVALID_CODE_TITLE, message: INVALID_CODE_TITLE });
  }
}

/**
 * Send limiter, one atomic step: 1 and records the send, or 0 when the last send was under 60 s
 * ago or 5 were already made this hour. The hash holds `count` and `last` (ms).
 */
const SEND_SCRIPT = `
local l = redis.call('HGET', KEYS[1], 'last')
local c = redis.call('HGET', KEYS[1], 'count')
local last = l and tonumber(l) or 0
local count = c and tonumber(c) or 0
local now = tonumber(ARGV[1])
if now - last < tonumber(ARGV[2]) then return 0 end
if count >= tonumber(ARGV[3]) then return 0 end
redis.call('HINCRBY', KEYS[1], 'count', 1)
redis.call('HSET', KEYS[1], 'last', ARGV[1])
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[4]) end
return 1
`;

/**
 * Uses one try before the code is compared, so parallel guesses cannot exceed 5. Returns nothing
 * when there is no code or no tries are left (the code is deleted then), else the stored HMAC and
 * the tries left after this one. KEEPTTL leaves the 10-minute expiry alone.
 */
const RESERVE_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if not v then return false end
local o = cjson.decode(v)
if o.attemptsLeft <= 0 then
  redis.call('DEL', KEYS[1])
  return false
end
o.attemptsLeft = o.attemptsLeft - 1
redis.call('SET', KEYS[1], cjson.encode(o), 'KEEPTTL')
return {o.hash, o.attemptsLeft}
`;

/** Single use: only the caller whose DEL removed the key may sign in. */
const CONSUME_SCRIPT = `return redis.call('DEL', KEYS[1])`;

const DUMMY_HASH = hmac('dummy', 'dummy');
/** Never a real tenant or user id, so `auth:otp:NO_ID:NO_ID` never holds a code. */
const NO_ID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class EmailCodeService {
  private readonly logger = new Logger(EmailCodeService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly producer: QueueProducer,
    private readonly email: EmailService,
    private readonly sessions: SessionService,
    private readonly events: AuthEventsService,
  ) {}

  private otpKey = (tenantId: string, userId: string) => `auth:otp:${tenantId}:${userId}`;
  private sentKey = (tenantId: string, userId: string) => `auth:otp-sent:${tenantId}:${userId}`;
  private codeHash = (tenantId: string, userId: string, code: string) =>
    hmac(this.env.AUTH_SECRET, `${tenantId}:${userId}:${code}`);

  /**
   * Enqueues the work and answers at once, so the response never depends on whether the account
   * exists. Fails fast with 503 when the queue cannot be reached.
   */
  async request(input: CodeRequest): Promise<CodeRequestAccepted> {
    const data: SendCodeJobData = { schoolCode: input.schoolCode, email: input.email };
    try {
      await this.producer.add(AUTH_QUEUE, SEND_CODE_JOB, data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        // The data holds the typed email: gone once sent, kept an hour if it fails.
        removeOnComplete: true,
        removeOnFail: { age: 3600 },
      });
    } catch (error) {
      this.logger.warn(`Sign-in code not queued: ${String(error)}`);
      throw new ServiceUnavailableException({
        title: 'Service temporarily unavailable.',
        message: 'We could not send a code right now. Try again in a moment.',
      });
    }
    return { maskedEmail: maskEmail(input.email) };
  }

  /** Runs in the `auth.send-code` job. Does nothing unless every condition holds. */
  async processSend(data: SendCodeJobData): Promise<void> {
    const tenant = await findActiveTenant(this.prisma, data.schoolCode);
    if (!tenant) return;
    const user = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (!user) return;
    const membership = await findActiveMembership(this.prisma, tenant.id, user.id);
    if (!membership) return;

    const sentKey = this.sentKey(tenant.id, user.id);
    const allowed = await this.redis.client.eval(
      SEND_SCRIPT,
      1,
      sentKey,
      Date.now(),
      MIN_SECONDS_BETWEEN_SENDS * 1000,
      MAX_SENDS_PER_HOUR,
      3600,
    );
    if (allowed !== 1) return;

    // The raw code lives only in this function and the email.
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    try {
      await this.redis.client.set(
        this.otpKey(tenant.id, user.id),
        JSON.stringify({
          hash: this.codeHash(tenant.id, user.id, code),
          attemptsLeft: MAX_TRIES,
        }),
        'EX',
        CODE_TTL_SECONDS,
      );
      // The code is dead after 10 minutes, so a failed email job is not kept longer.
      await this.email.enqueue(
        {
          to: user.email,
          ...signInCodeEmail({ schoolName: tenant.name, code, minutes: CODE_MINUTES }),
        },
        { keepFailedSeconds: CODE_TTL_SECONDS },
      );
    } catch (error) {
      // Give the send back so the job's retry is not mistaken for a repeat request.
      await this.redis.client.hincrby(sentKey, 'count', -1).catch(() => undefined);
      await this.redis.client.hset(sentKey, 'last', '0').catch(() => undefined);
      throw error;
    }
    await this.events.record({
      type: 'CODE_REQUESTED',
      method: 'EMAIL_CODE',
      userId: user.id,
      tenantId: tenant.id,
    });
  }

  async verify(
    input: CodeVerifyRequest,
    meta: SignInMeta = {},
  ): Promise<{ token: string; session: AuthSession; remember: boolean }> {
    const eventBase = { method: 'EMAIL_CODE', ip: meta.ip, userAgent: meta.userAgent } as const;

    const tenant = await findActiveTenant(this.prisma, input.schoolCode);
    const user = tenant
      ? await this.prisma.user.findUnique({ where: { email: input.email } })
      : null;
    const membership = tenant ? await findActiveMembership(this.prisma, tenant.id, user?.id) : null;

    // An unknown account checks a key that never exists: the same one Redis call (and the same
    // 503 while Redis is down), so neither timing nor an outage reveals whether it exists.
    const known = tenant && user && membership;
    const checked = await this.checkCode(tenant?.id ?? NO_ID, known ? user.id : NO_ID, input.code);
    const matched = known ? checked : false;

    if (!tenant || !user || !membership || !matched) {
      await this.events.record({
        type: 'SIGN_IN_FAILED',
        userId: user?.id,
        tenantId: tenant?.id,
        ...eventBase,
      });
      throw new InvalidCodeException();
    }

    // The code proves the address; a password pause is left as it is.
    if (!user.emailVerifiedAt) {
      await this.prisma.user.updateMany({
        where: { id: user.id, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
    }
    let created: Awaited<ReturnType<SessionService['create']>>;
    try {
      created = await this.sessions.create({
        userId: user.id,
        tenantId: tenant.id,
        membershipId: membership.id,
        remember: input.remember,
        ip: meta.ip,
        userAgent: meta.userAgent,
        replacesToken: meta.currentToken,
        passwordChangedAt: user.passwordChangedAt,
      });
    } catch (error) {
      if (error instanceof CredentialsChangedError) throw new InvalidCodeException();
      throw error;
    }
    const { token, session } = created;
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
      session: await this.sessions.toAuthSession({ session, tenant }, membership, user),
    };
  }

  /** Spends a try, compares in constant time, and on a match consumes the code exactly once. */
  private async checkCode(tenantId: string, userId: string, code: string): Promise<boolean> {
    const key = this.otpKey(tenantId, userId);
    try {
      const reserved = (await this.redis.client.eval(RESERVE_SCRIPT, 1, key)) as
        [string, number] | null;
      const [stored, left] = reserved ?? [DUMMY_HASH, 0];
      const same = this.equal(stored, this.codeHash(tenantId, userId, code));
      if (same && reserved) return (await this.redis.client.eval(CONSUME_SCRIPT, 1, key)) === 1;
      if (reserved && left <= 0) await this.redis.client.del(key);
      return false;
    } catch (error) {
      this.logger.warn(`Code check failed, Redis unavailable: ${String(error)}`);
      throw new ServiceUnavailableException({
        title: 'Service temporarily unavailable.',
        message: 'We could not check the code right now. Try again in a moment.',
      });
    }
  }

  private equal(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
