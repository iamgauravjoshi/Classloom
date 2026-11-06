import { createHash, randomBytes } from 'node:crypto';

import {
  DEFAULT_SERIES,
  NUMBER_SERIES_KEYS,
  type SchoolRegistrationAccepted,
  type SchoolRegistrationRequest,
} from '@classloom/contracts';
import { suggestSchoolCode } from '@classloom/utils';
import { ConflictException, GoneException, Inject, Injectable, Logger } from '@nestjs/common';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { EmailService } from '../../core/email/email.service';
import { verifyRegistrationEmail } from '../../core/email/templates/verify-registration';
import { TooManyRequestsException } from '../../core/http/too-many-requests.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { QueueProducer } from '../../core/queue/queue.module';
import { RedisService } from '../../core/redis/redis.service';
import { withNewTenant, withTenant } from '../../core/tenancy/with-tenant';
import { maskEmail } from './mask-email';
import { SchoolCodeService } from './school-code.service';
import { registrationTokenExpiry } from './token-expiry';

export const REGISTRATION_QUEUE = 'registration';
export const RESEND_JOB = 'resend-verification';
const MAX_PENDING_PER_EMAIL = 3;
const RESEND_LIMIT = 3;
const RESEND_WINDOW_SECONDS = 3600;
const LINK_GONE = 'This verification link is no longer valid.';
const CODE_TAKEN = 'This school code is already taken.';

const hashToken = (raw: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(createHash('sha256').update(Buffer.from(raw, 'base64url')).digest());

@Injectable()
export class SchoolRegistrationService {
  private readonly logger = new Logger(SchoolRegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly redis: RedisService,
    private readonly codes: SchoolCodeService,
    @Inject(ENV) private readonly env: Env,
    private readonly producer: QueueProducer,
  ) {}

  async register(input: SchoolRegistrationRequest): Promise<SchoolRegistrationAccepted> {
    const maskedEmail = maskEmail(input.email);
    // Returned even when nothing is created, so the response never reveals the pending cap.
    const cancel = this.newToken();

    // `tenants` is a platform table, so this count works without a tenant context. It is a soft
    // limit: concurrent requests could overshoot it by a few, which is harmless.
    const pending = await this.prisma.tenant.count({
      where: { contactEmail: input.email, status: 'PENDING_VERIFICATION' },
    });
    if (pending >= MAX_PENDING_PER_EMAIL) {
      this.logger.warn(`Registration ignored: ${maskedEmail} has ${pending} pending schools`);
      return { maskedEmail, cancelToken: cancel.raw };
    }

    const mobile = await this.freeMobile(input.mobile, input.email);
    const { raw, hash } = this.newToken();
    try {
      await withNewTenant(
        this.prisma,
        (tx) =>
          tx.tenant.create({
            data: {
              code: input.code,
              name: input.schoolName,
              board: input.board,
              city: input.city,
              state: input.state,
              contactEmail: input.email,
              termsAcceptedAt: new Date(),
              cancelTokenHash: cancel.hash,
            },
          }),
        async (tx, tenant) => {
          const expiresAt = this.expiry(tenant.createdAt);
          await tx.campus.create({
            data: {
              tenantId: tenant.id,
              name: input.schoolName,
              isPrimary: true,
              city: input.city,
              state: input.state,
            },
          });
          // Every school has exactly one profile row (onboarding spec section 12); it starts with
          // the registration's city and state.
          await tx.schoolProfile.create({
            data: { tenantId: tenant.id, city: input.city, state: input.state },
          });
          // The four number series with their defaults (Part 6a spec section 3).
          await tx.numberSeries.createMany({
            data: NUMBER_SERIES_KEYS.map((key) => ({
              tenantId: tenant.id,
              key,
              ...DEFAULT_SERIES[key],
            })),
          });
          const user = await tx.user.upsert({
            where: { email: input.email },
            create: { email: input.email, name: input.adminName, mobile },
            update: {},
          });
          const membership = await tx.membership.create({
            data: { tenantId: tenant.id, userId: user.id },
          });
          // The nine built-in roles (IAM spec section 5), then Owner for the registering user.
          // Runs as the app role inside the new school's tenant context, so RLS confines it.
          await tx.$executeRaw`SELECT seed_builtin_roles(${tenant.id}::uuid)`;
          const ownerRole = await tx.role.findFirstOrThrow({
            where: { tenantId: tenant.id, key: 'OWNER' },
            select: { id: true },
          });
          await tx.membershipRole.create({
            data: { tenantId: tenant.id, membershipId: membership.id, roleId: ownerRole.id },
          });
          await tx.registrationToken.create({
            data: { tenantId: tenant.id, tokenHash: hash, expiresAt },
          });
          await this.sendVerification(input.email, input.schoolName, input.code, raw, expiresAt);
        },
      );
    } catch (error) {
      if (isUniqueViolation(error) && (await this.codeIsTaken(input.code))) {
        throw await this.codeTakenException(input);
      }
      throw error;
    }
    return { maskedEmail, cancelToken: cancel.raw };
  }

  /**
   * "Use a different email": withdraws the registration while it is still pending, freeing its
   * code. Unknown, used or verified tokens do nothing, and the caller always answers the same.
   * The work runs in a SECURITY DEFINER function (see its migration) because deciding whether
   * the user is left with no school needs memberships that row-level security hides.
   */
  async cancel(cancelToken: string): Promise<void> {
    await this.prisma.$queryRaw`SELECT cancel_pending_registration(${hashToken(cancelToken)})`;
  }

  async resend(input: { email: string; code: string }): Promise<void> {
    // Counted before any lookup so the limit says nothing about whether a registration exists.
    const key = `reg-resend:${input.email}:${input.code}`;
    const attempts = await this.redis.client.incr(key);
    if (attempts === 1) await this.redis.client.expire(key, RESEND_WINDOW_SECONDS);
    if (attempts > RESEND_LIMIT) {
      throw new TooManyRequestsException('Too many requests. Try again later.');
    }
    await this.producer.add(REGISTRATION_QUEUE, RESEND_JOB, input, {
      removeOnComplete: true,
      removeOnFail: { age: 24 * 3600 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  }

  /** Runs in the `resend-verification` job, so the HTTP response never depends on a match. */
  async processResend(input: { email: string; code: string }): Promise<void> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { code: input.code, contactEmail: input.email, status: 'PENDING_VERIFICATION' },
    });
    const owner = tenant
      ? await this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })
      : null;
    if (!tenant || !owner) return;
    const isOwner = await withTenant(
      this.prisma,
      tenant.id,
      async (tx) =>
        (await tx.membership.count({
          where: {
            tenantId: tenant.id,
            userId: owner.id,
            status: 'ACTIVE',
            roles: { some: { role: { key: 'OWNER' } } },
          },
        })) > 0,
    );
    if (!isOwner) return;

    const expiresAt = this.expiry(tenant.createdAt);
    // Past its purge time the registration is about to be deleted: a link would be dead on
    // arrival. Registering again (once the code is freed) is the way back.
    if (expiresAt.getTime() <= Date.now()) return;
    const { raw, hash } = this.newToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.registrationToken.updateMany({
        where: { tenantId: tenant.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.registrationToken.create({
        data: { tenantId: tenant.id, tokenHash: hash, expiresAt },
      });
      await this.sendVerification(input.email, tenant.name, tenant.code, raw, expiresAt);
    });
  }

  async verify(token: string): Promise<{ code: string; name: string }> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.registrationToken.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { tenant: true },
      });
      if (!record || record.usedAt || record.expiresAt <= now) throw new GoneException(LINK_GONE);

      // Claiming the token and the tenant atomically makes concurrent clicks safe: one wins.
      const claimed = await tx.registrationToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: now },
      });
      const activated = await tx.tenant.updateMany({
        where: { id: record.tenantId, status: 'PENDING_VERIFICATION' },
        data: { status: 'ACTIVE', verifiedAt: now, cancelTokenHash: null },
      });
      if (claimed.count === 0 || activated.count === 0) throw new GoneException(LINK_GONE);
      await tx.user.updateMany({
        where: { email: record.tenant.contactEmail, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
      return { code: record.tenant.code.toUpperCase(), name: record.tenant.name };
    });
  }

  /**
   * A mobile number is unique across users, and a public `409` would reveal whether a number is
   * registered, so a number held by someone else is silently dropped: the school is still
   * created and the owner can add a mobile later on the account page. Two concurrent
   * registrations with the same new number can still race on `users_mobile_key`; that surfaces as
   * a 500 and is accepted as rare.
   */
  private async freeMobile(mobile: string | undefined, email: string): Promise<string | null> {
    if (!mobile) return null;
    const holder = await this.prisma.user.findFirst({
      where: { mobile, NOT: { email } },
      select: { id: true },
    });
    return holder ? null : mobile;
  }

  private newToken(): { raw: string; hash: Uint8Array<ArrayBuffer> } {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: hashToken(raw) };
  }

  private expiry(tenantCreatedAt: Date): Date {
    return registrationTokenExpiry({
      now: new Date(),
      tenantCreatedAt,
      tokenTtlHours: this.env.REGISTRATION_TOKEN_TTL_HOURS,
      pendingTtlHours: this.env.PENDING_TENANT_TTL_HOURS,
    });
  }

  private sendVerification(
    to: string,
    schoolName: string,
    code: string,
    rawToken: string,
    expiresAt: Date,
  ): Promise<void> {
    const verifyUrl = `${this.env.WEB_ORIGIN}/en/register-school/verify?token=${rawToken}`;
    return this.email.enqueue({
      to,
      ...verifyRegistrationEmail({ schoolName, code, verifyUrl, expiresAt }),
    });
  }

  private async codeIsTaken(code: string): Promise<boolean> {
    return (await this.prisma.tenant.count({ where: { code } })) > 0;
  }

  private async codeTakenException(input: SchoolRegistrationRequest): Promise<ConflictException> {
    const suggestion = await this.codes.nextFreeCode(
      suggestSchoolCode(input.schoolName, input.city),
    );
    return new ConflictException({
      message: CODE_TAKEN,
      errors: [{ path: 'code', message: CODE_TAKEN }],
      suggestion,
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}
