import type { Readable } from 'node:stream';

import type { SchoolProfile, UpdateSchoolProfileRequest } from '@classloom/contracts';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  FILE_STORAGE,
  type FileStorage,
  StorageObjectNotFoundError,
  StorageUnavailableError,
} from '../../core/files/file-storage';
import { FilesService } from '../../core/files/files.service';
import { ImageIntake, ImageRejectedError } from '../../core/files/image-intake';
import { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import type { Prisma } from '../../generated/prisma/client';
import type { RequestAuth } from '../auth/request-auth';
import { AuditService } from '../iam/audit.service';
import { SchoolLimits } from './school-limits';
import { LogoInvalidException, StorageUnavailableException } from './school-problems';

export interface SchoolMeta {
  ip?: string;
  userAgent?: string;
}

type Actor = Pick<RequestAuth, 'tenantId' | 'userId'>;

/** The fields `PUT /school/profile` replaces, in the response's order. */
const EDITABLE_KEYS = [
  'name',
  'board',
  'legalName',
  'shortName',
  'establishedYear',
  'udiseCode',
  'affiliationNumber',
  'schoolType',
  'residential',
  'medium',
  'lowestClass',
  'highestClass',
  'phone',
  'email',
  'website',
  'addressLine1',
  'addressLine2',
  'city',
  'district',
  'state',
  'pinCode',
] as const satisfies readonly (keyof UpdateSchoolProfileRequest & keyof SchoolProfile)[];

/** The versioned logo URL clients cache for a year (spec section 5). */
export const logoUrlFor = (fileId: string): string => `/api/school/logo?v=${fileId}`;

/** A logo to stream: its file id (the ETag) and the stored PNG, or null for a 304. */
export interface LogoObject {
  fileId: string;
  body: Readable | null;
}

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly intake: ImageIntake,
    private readonly limits: SchoolLimits,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  /**
   * The school's profile, read in `tx` (a `withTenant` transaction: row-level security admits
   * only that school's row). Every school has exactly one profile row, made at registration and
   * by the onboarding migration, so a missing row is an invariant break (500), never upserted.
   */
  async load(tx: Prisma.TransactionClient): Promise<SchoolProfile> {
    const row = await tx.schoolProfile.findFirst({
      include: { tenant: { select: { name: true, board: true, code: true } } },
    });
    if (!row) throw new Error('School profile row missing for the current tenant');
    return {
      name: row.tenant.name,
      board: row.tenant.board,
      code: row.tenant.code,
      legalName: row.legalName,
      shortName: row.shortName,
      establishedYear: row.establishedYear,
      udiseCode: row.udiseCode,
      affiliationNumber: row.affiliationNumber,
      schoolType: row.schoolType,
      residential: row.residential,
      medium: row.medium,
      lowestClass: row.lowestClass,
      highestClass: row.highestClass,
      phone: row.phone,
      email: row.email,
      website: row.website,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      city: row.city,
      district: row.district,
      state: row.state,
      pinCode: row.pinCode,
      logoUrl: row.logoFileId ? logoUrlFor(row.logoFileId) : null,
    };
  }

  get(auth: Actor): Promise<SchoolProfile> {
    return withTenant(this.prisma, auth.tenantId, (tx) => this.load(tx));
  }

  /**
   * Replaces the editable fields. `name` and `board` live on `tenants`; `city` and `state` are
   * copied there too (a cleared city leaves `tenants.city` as it was, since it is required).
   * One `school.profile_updated` event holds only the changed keys; no change writes nothing.
   */
  update(auth: Actor, input: UpdateSchoolProfileRequest, meta: SchoolMeta): Promise<SchoolProfile> {
    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      await lockProfile(tx, auth.tenantId);
      const current = await this.load(tx);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of EDITABLE_KEYS) {
        if (current[key] !== input[key]) {
          before[key] = current[key];
          after[key] = input[key];
        }
      }
      if (Object.keys(after).length === 0) return current;

      const { name, board, city, state, ...profile } = input;
      await tx.tenant.update({
        where: { id: auth.tenantId },
        data: { name, board, state, ...(city !== null ? { city } : {}) },
      });
      await tx.schoolProfile.update({
        where: { tenantId: auth.tenantId },
        data: { ...profile, city, state },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'school.profile_updated',
        targetType: 'school',
        targetId: auth.tenantId,
        before: before as Prisma.InputJsonObject,
        after: after as Prisma.InputJsonObject,
        actor: auth,
        meta,
      });
      return this.load(tx);
    });
  }

  /**
   * Turns the upload into a safe PNG, stores it and points the profile at it, in one
   * transaction with the audit event. The object stored is removed again if the transaction
   * rolls back; the replaced logo's object is deleted after the commit (its row is kept).
   */
  async uploadLogo(auth: Actor, upload: Buffer | undefined, meta: SchoolMeta) {
    await this.limits.countLogoUpload(auth.tenantId);
    const image = await this.intake.toLogoPng(upload ?? Buffer.alloc(0)).catch((error: unknown) => {
      throw error instanceof ImageRejectedError ? new LogoInvalidException(error.reason) : error;
    });

    const pending: { storageKey?: string } = {};
    let result: { profile: SchoolProfile; replacedKey: string | null };
    try {
      result = await withTenant(this.prisma, auth.tenantId, async (tx) => {
        await lockProfile(tx, auth.tenantId);
        const previous = await this.currentLogo(tx, auth.tenantId);
        const { fileId, storageKey } = await this.files.store(tx, {
          tenantId: auth.tenantId,
          purpose: 'SCHOOL_LOGO',
          image,
          userId: auth.userId,
        });
        pending.storageKey = storageKey;
        await tx.schoolProfile.update({
          where: { tenantId: auth.tenantId },
          data: { logoFileId: fileId },
        });
        await this.audit.record(tx, {
          tenantId: auth.tenantId,
          action: 'school.logo_changed',
          targetType: 'school',
          targetId: auth.tenantId,
          before: { logoFileId: previous?.id ?? null },
          after: { logoFileId: fileId },
          actor: auth,
          meta,
        });
        return { profile: await this.load(tx), replacedKey: previous?.storageKey ?? null };
      });
    } catch (error) {
      if (pending.storageKey) await this.files.removeObject(pending.storageKey);
      if (error instanceof StorageUnavailableError) throw new StorageUnavailableException();
      throw error;
    }
    if (result.replacedKey) await this.files.removeObject(result.replacedKey);
    return result.profile;
  }

  /** Clears the logo; the object is deleted after the commit. No logo: nothing happens. */
  async removeLogo(auth: Actor, meta: SchoolMeta): Promise<void> {
    const removedKey = await withTenant(this.prisma, auth.tenantId, async (tx) => {
      await lockProfile(tx, auth.tenantId);
      const previous = await this.currentLogo(tx, auth.tenantId);
      if (!previous) return null;
      await tx.schoolProfile.update({
        where: { tenantId: auth.tenantId },
        data: { logoFileId: null },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'school.logo_removed',
        targetType: 'school',
        targetId: auth.tenantId,
        before: { logoFileId: previous.id },
        after: { logoFileId: null },
        actor: auth,
        meta,
      });
      return previous.storageKey;
    });
    if (removedKey) await this.files.removeObject(removedKey);
  }

  /**
   * The school's current logo. The `v` query parameter is never used to pick the file: a school
   * only ever sees its own logo. 404 without a logo, or when its object is gone. When
   * `ifNoneMatch` is the current ETag, storage is not read and `body` is null (a 304).
   */
  async openLogo(auth: Actor, ifNoneMatch?: string): Promise<LogoObject> {
    const logo = await withTenant(this.prisma, auth.tenantId, (tx) =>
      this.currentLogo(tx, auth.tenantId),
    );
    if (!logo) throw new NotFoundException('This school has no logo.');
    if (ifNoneMatch === `"${logo.id}"`) return { fileId: logo.id, body: null };
    try {
      return { fileId: logo.id, body: await this.storage.get(logo.storageKey) };
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        throw new NotFoundException('This school has no logo.');
      }
      if (error instanceof StorageUnavailableError) throw new StorageUnavailableException();
      throw error;
    }
  }

  private async currentLogo(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<{ id: string; storageKey: string } | null> {
    const row = await tx.schoolProfile.findUnique({
      where: { tenantId },
      select: { logoFile: { select: { id: true, storageKey: true } } },
    });
    if (!row) throw new Error('School profile row missing for the current tenant');
    return row.logoFile;
  }
}

/** Serialises changes to one school's profile (and so to its logo). */
async function lockProfile(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM school_profiles WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`;
}
