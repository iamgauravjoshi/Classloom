import os from 'node:os';

import {
  createAcademicYearRequestSchema,
  type CreateCampusRequest,
  createCampusRequestSchema,
  updateCampusRequestSchema,
  updateSchoolProfileRequestSchema,
} from '@classloom/contracts';
import { academicYearOf, normaliseSchoolCode } from '@classloom/utils';
import { type DynamicModule, type INestApplicationContext, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Command } from 'commander';
import sharp from 'sharp';

import { ConfigModule, ENV } from '../core/config/config.module';
import type { Env } from '../core/config/env.schema';
import { FilesModule } from '../core/files/files.module';
import { PlatformPrismaService } from '../core/prisma/platform-prisma.service';
import { PrismaModule } from '../core/prisma/prisma.module';
import { RedisModule } from '../core/redis/redis.module';
import { TenancyCoreModule } from '../core/tenancy/tenancy-core.module';
import { AuditService } from '../modules/iam/audit.service';
import { AcademicYearsService } from '../modules/school/academic-years.service';
import { CampusesService } from '../modules/school/campuses.service';
import { ProfileService } from '../modules/school/profile.service';
import { SchoolLimits } from '../modules/school/school-limits';
import { StorageUnavailableException } from '../modules/school/school-problems';

/** The steps of `school:demo-setup`, named after the checklist items they complete. */
type Step = 'profile' | 'logo' | 'academicYear' | 'campuses';

/** Audit rows of a CLI change carry no user; the user agent says where they came from. */
const CLI_META = { userAgent: 'classloom-cli school:demo-setup' };

/** Demo values for the profile fields a school has left empty. */
const DEMO_PROFILE = {
  legalName: 'Demo Education Society',
  establishedYear: 1998,
  udiseCode: '05050100101',
  affiliationNumber: 'DEMO/1998-01',
  schoolType: 'CO_ED',
  residential: 'DAY',
  medium: 'English',
  lowestClass: 'NURSERY',
  highestClass: 'XII',
  phone: '98450 11223',
  email: 'office@example.com',
  website: 'https://example.com',
  addressLine1: '12 Rajpur Road',
  addressLine2: 'Near Clock Tower',
  district: 'Dehradun',
  pinCode: '248001',
} as const;

const SECOND_CAMPUS: CreateCampusRequest = createCampusRequestSchema.parse({
  name: 'Junior Wing',
  addressLine1: '4 Old Survey Road',
  district: 'Dehradun',
  pinCode: '248001',
  phone: '98450 11224',
});

/**
 * The school services on the app role (row-level security on, scoped by `withTenant`), built
 * only when `school:demo-setup` runs so the other commands need neither Redis nor storage.
 */
@Module({})
class SchoolSetupModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: SchoolSetupModule,
      imports: [
        ConfigModule.forRoot(env),
        TenancyCoreModule,
        PrismaModule,
        RedisModule,
        FilesModule,
      ],
      providers: [
        AuditService,
        SchoolLimits,
        ProfileService,
        AcademicYearsService,
        CampusesService,
      ],
    };
  }
}

/** A plain 256 px demo logo: a filled circle with an open book, drawn without fonts. */
function demoLogoPng(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <circle cx="128" cy="128" r="120" fill="#1d4ed8"/>
    <path d="M56 84 L124 100 L124 184 L56 168 Z" fill="#ffffff"/>
    <path d="M200 84 L132 100 L132 184 L200 168 Z" fill="#dbeafe"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** The academic year (April to March, IST) containing today. */
function currentYearDates(): { startsOn: string; endsOn: string } {
  const start = Number(academicYearOf(new Date()).slice(0, 4));
  return { startsOn: `${start}-04-01`, endsOn: `${start + 1}-03-31` };
}

/**
 * Adds `school:demo-setup <code>`, which fills a school the way the onboarding wizard would: a
 * full profile, a generated logo, a current year with 3 terms, the primary campus's address and
 * a second campus. It goes through the API's own services under the school's tenant context, so
 * the usual validation, locks and audit events apply. Anything the school already has is kept
 * and reported as skipped, so running it again changes nothing.
 */
export function registerSchoolCommands(
  program: Command,
  app: INestApplicationContext,
  out: (line: string) => void,
): void {
  const platform = app.get(PlatformPrismaService);

  program
    .command('school:demo-setup')
    .description('Fill a school with demo profile, logo, current year and a second campus')
    .argument('<code>')
    .action(async (raw: string) => {
      const code = normaliseSchoolCode(raw);
      const tenant = await platform.tenant.findUnique({ where: { code } });
      if (!tenant) throw new Error(`School ${code.toUpperCase()} not found`);

      const ctx = await NestFactory.createApplicationContext(
        SchoolSetupModule.forRoot(app.get<Env>(ENV)),
        { logger: false },
      );
      try {
        const steps = await demoSetup(ctx, tenant.id);
        out(
          JSON.stringify({
            action: 'demo-setup',
            code: code.toUpperCase(),
            done: steps.done,
            skipped: steps.skipped,
            reasons: steps.reasons,
            by: operatorName(),
          }),
        );
      } finally {
        await ctx.close();
      }
    });
}

async function demoSetup(
  ctx: INestApplicationContext,
  tenantId: string,
): Promise<{ done: Step[]; skipped: Step[]; reasons: Partial<Record<Step, string>> }> {
  const profiles = ctx.get(ProfileService);
  const years = ctx.get(AcademicYearsService);
  const campuses = ctx.get(CampusesService);
  const actor = { tenantId, userId: null };
  const done: Step[] = [];
  const skipped: Step[] = [];
  const reasons: Partial<Record<Step, string>> = {};
  const mark = (step: Step, changed: boolean) => (changed ? done : skipped).push(step);

  // Profile: fill only the empty fields, keeping whatever the school entered.
  const current = await profiles.get(actor);
  const { code: _code, logoUrl, ...editable } = current;
  const filled = Object.fromEntries(
    Object.entries(editable).map(([key, value]) => [
      key,
      value ?? (DEMO_PROFILE as Record<string, unknown>)[key] ?? null,
    ]),
  );
  const missing = Object.keys(DEMO_PROFILE).some(
    (key) => editable[key as keyof typeof editable] === null,
  );
  if (missing) {
    await profiles.update(actor, updateSchoolProfileRequestSchema.parse(filled), CLI_META);
  }
  mark('profile', missing);

  // Logo: a generated PNG through the same intake as an upload.
  if (logoUrl === null) {
    try {
      await profiles.uploadLogo(actor, await demoLogoPng(), CLI_META);
    } catch (error) {
      if (error instanceof StorageUnavailableException) {
        throw new Error('File storage is unreachable; start it and run the command again', {
          cause: error,
        });
      }
      throw error;
    }
  }
  mark('logo', logoUrl === null);

  // Academic year: only for a school without any year, so a real calendar is never touched.
  const { years: existing } = await years.list(actor);
  if (existing.length === 0) {
    await years.create(
      actor,
      createAcademicYearRequestSchema.parse({ ...currentYearDates(), termCount: 3 }),
      CLI_META,
    );
  }
  mark('academicYear', existing.length === 0);
  if (existing.length > 0) {
    const list = existing.map((y) => `${y.label} (${y.status})`).join(', ');
    reasons.academicYear = existing.some((y) => y.status === 'CURRENT')
      ? `The school already has a current year: ${list}`
      : `The school already has years (${list}) but none is current; demo setup never changes ` +
        'an existing calendar, so make one current in Settings';
  }

  // Campuses: the primary campus's address and PIN where missing, plus a second campus.
  const { campuses: all } = await campuses.list(actor, true);
  const primary = all.find((c) => c.isPrimary);
  if (!primary) throw new Error('The school has no primary campus');
  const address = {
    ...(primary.addressLine1 === null ? { addressLine1: DEMO_PROFILE.addressLine1 } : {}),
    ...(primary.pinCode === null ? { pinCode: DEMO_PROFILE.pinCode } : {}),
  };
  if (Object.keys(address).length > 0) {
    await campuses.update(actor, primary.id, updateCampusRequestSchema.parse(address), CLI_META);
  }
  if (all.length === 1) await campuses.create(actor, SECOND_CAMPUS, CLI_META);
  mark('campuses', Object.keys(address).length > 0 || all.length === 1);

  return { done, skipped, reasons };
}

/** Who ran the command; `os.userInfo()` throws when the uid has no passwd entry. */
function operatorName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER || process.env.USERNAME || 'unknown';
  }
}
