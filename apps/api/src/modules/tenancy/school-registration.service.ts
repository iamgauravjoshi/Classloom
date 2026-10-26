import { createHash, randomBytes } from 'node:crypto';

import type { SchoolRegistrationRequest } from '@classloom/contracts';
import { suggestSchoolCode } from '@classloom/utils';
import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, GoneException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { EmailService } from '../../core/email/email.service';
import { verifyRegistrationEmail } from '../../core/email/templates/verify-registration';
import { TooManyRequestsException } from '../../core/http/too-many-requests.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { withNewTenant, withTenant } from '../../core/tenancy/with-tenant';
import { maskEmail } from './mask-email';
import { SchoolCodeService } from './school-code.service';

export const REGISTRATION_QUEUE = 'registration';
export const RESEND_JOB = 'resend-verification';
const MAX_PENDING_PER_EMAIL = 3;
const RESEND_LIMIT = 3;
const RESEND_WINDOW_SECONDS = 3600;
const HOUR_MS = 3_600_000;
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
    @InjectQueue(REGISTRATION_QUEUE) private readonly queue: Queue,
  ) {}

  async register(input: SchoolRegistrationRequest): Promise<{ maskedEmail: string }> {
    const maskedEmail = maskEmail(input.email);

    // `tenants` is a platform table, so this count works without a tenant context. It is a soft
    // limit: concurrent requests could overshoot it by a few, which is harmless.
    const pending = await this.prisma.tenant.count({
      where: { contactEmail: input.email, status: 'PENDING_VERIFICATION' },
    });
    if (pending >= MAX_PENDING_PER_EMAIL) {
      this.logger.warn(`Registration ignored: ${maskedEmail} has ${pending} pending schools`);
      return { maskedEmail };
    }

    const { raw, hash } = this.newToken();
    const expiresAt = this.expiry();
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
            },
          }),
        async (tx, tenant) => {
          await tx.campus.create({
            data: {
              tenantId: tenant.id,
              name: input.schoolName,
              isPrimary: true,
              city: input.city,
              state: input.state,
            },
          });
          const user = await tx.user.upsert({
            where: { email: input.email },
            create: { email: input.email, name: input.adminName, mobile: input.mobile },
            update: {},
          });
          await tx.membership.create({
            data: { tenantId: tenant.id, userId: user.id, role: 'OWNER' },
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
    return { maskedEmail };
  }

  async resend(input: { email: string; code: string }): Promise<void> {
    // Counted before any lookup so the limit says nothing about whether a registration exists.
    const key = `reg-resend:${input.email}:${input.code}`;
    const attempts = await this.redis.client.incr(key);
    if (attempts === 1) await this.redis.client.expire(key, RESEND_WINDOW_SECONDS);
    if (attempts > RESEND_LIMIT) {
      throw new TooManyRequestsException('Too many requests. Try again later.');
    }
    await this.queue.add(RESEND_JOB, input, {
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
          where: { tenantId: tenant.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
        })) > 0,
    );
    if (!isOwner) return;

    const { raw, hash } = this.newToken();
    const expiresAt = this.expiry();
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
        data: { status: 'ACTIVE', verifiedAt: now },
      });
      if (claimed.count === 0 || activated.count === 0) throw new GoneException(LINK_GONE);
      await tx.user.updateMany({
        where: { email: record.tenant.contactEmail, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
      return { code: record.tenant.code.toUpperCase(), name: record.tenant.name };
    });
  }

  private newToken(): { raw: string; hash: Uint8Array<ArrayBuffer> } {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: hashToken(raw) };
  }

  private expiry(): Date {
    return new Date(Date.now() + this.env.REGISTRATION_TOKEN_TTL_HOURS * HOUR_MS);
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
