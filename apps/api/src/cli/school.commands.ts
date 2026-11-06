import os from 'node:os';

import {
  type ClassLevel,
  type ClassSubjectRow,
  createAcademicYearRequestSchema,
  type CreateCampusRequest,
  createCampusRequestSchema,
  createRoomRequestSchema,
  createSectionRequestSchema,
  createStreamRequestSchema,
  isInRange,
  type RoomType,
  starterSubjectsRequestSchema,
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
import { ClassSubjectsService } from '../modules/academics/class-subjects.service';
import { RoomsService } from '../modules/academics/rooms.service';
import { SectionsService } from '../modules/academics/sections.service';
import { StreamsService } from '../modules/academics/streams.service';
import { SubjectsService } from '../modules/academics/subjects.service';
import { AuditService } from '../modules/iam/audit.service';
import { AcademicYearsService } from '../modules/school/academic-years.service';
import { CampusesService } from '../modules/school/campuses.service';
import { ProfileService } from '../modules/school/profile.service';
import { SchoolLimits } from '../modules/school/school-limits';
import { StorageUnavailableException } from '../modules/school/school-problems';

/** The steps of `school:demo-setup`, named after the checklist items they complete. */
type Step = 'profile' | 'logo' | 'academicYear' | 'campuses' | 'academics';

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

/** Demo streams (academics spec section 11: two of the three starter streams). */
const DEMO_STREAMS = ['Science', 'Commerce'] as const;

/** Demo rooms on the primary campus. */
const DEMO_ROOMS: { name: string; type: RoomType; capacity: number; floor: string }[] = [
  { name: 'Room 101', type: 'CLASSROOM', capacity: 40, floor: 'Ground' },
  { name: 'Room 102', type: 'CLASSROOM', capacity: 40, floor: 'Ground' },
  { name: 'Science Lab', type: 'LAB', capacity: 30, floor: 'First' },
];

/** Demo sections of the current year on the primary campus, for two classes. */
const DEMO_SECTIONS: { classLevel: ClassLevel; name: string; stream?: string; room?: string }[] = [
  { classLevel: 'VI', name: 'A', room: 'Room 101' },
  { classLevel: 'VI', name: 'B', room: 'Room 102' },
  { classLevel: 'XI', name: 'A', stream: 'Science', room: 'Science Lab' },
  { classLevel: 'XI', name: 'B', stream: 'Commerce' },
];

/** Demo class subjects by subject and stream name; rows naming a missing subject are left out. */
const DEMO_CLASS_SUBJECTS: {
  classLevel: ClassLevel;
  rows: { subject: string; stream?: string; kind: ClassSubjectRow['kind'] }[];
}[] = [
  {
    classLevel: 'VI',
    rows: [
      { subject: 'English', kind: 'COMPULSORY' },
      { subject: 'Hindi', kind: 'COMPULSORY' },
      { subject: 'Mathematics', kind: 'COMPULSORY' },
      { subject: 'Science', kind: 'COMPULSORY' },
      { subject: 'Social Science', kind: 'COMPULSORY' },
      { subject: 'Computer', kind: 'OPTIONAL' },
    ],
  },
  {
    classLevel: 'XI',
    rows: [
      { subject: 'English Core', kind: 'COMPULSORY' },
      { subject: 'Physics', stream: 'Science', kind: 'COMPULSORY' },
      { subject: 'Chemistry', stream: 'Science', kind: 'COMPULSORY' },
      { subject: 'Mathematics', stream: 'Science', kind: 'COMPULSORY' },
      { subject: 'Biology', stream: 'Science', kind: 'OPTIONAL' },
      { subject: 'Accountancy', stream: 'Commerce', kind: 'COMPULSORY' },
      { subject: 'Business Studies', stream: 'Commerce', kind: 'COMPULSORY' },
      { subject: 'Economics', stream: 'Commerce', kind: 'COMPULSORY' },
      { subject: 'Mathematics', stream: 'Commerce', kind: 'OPTIONAL' },
    ],
  },
];

/** Names compare ignoring case, as the unique indexes do. */
const nameKey = (name: string) => name.toLowerCase();

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
        StreamsService,
        SubjectsService,
        ClassSubjectsService,
        RoomsService,
        SectionsService,
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
 * full profile, a generated logo, a current year with 3 terms, the primary campus's address, a
 * second campus, and the academic structure (two streams, three rooms, the board's starter
 * subjects, sections of VI and XI in the current year and their class subjects). It goes through
 * the API's own services under the school's tenant context, so the usual validation, locks and
 * audit events apply. Anything the school already has is kept and reported as skipped, so
 * running it again changes nothing.
 */
export function registerSchoolCommands(
  program: Command,
  app: INestApplicationContext,
  out: (line: string) => void,
): void {
  const platform = app.get(PlatformPrismaService);

  program
    .command('school:demo-setup')
    .description(
      'Fill a school with demo profile, logo, current year, a second campus and academics',
    )
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

  // Academics: streams, rooms, starter subjects, sections and class subjects.
  const academics = await demoAcademics(ctx, actor, primary.id);
  mark('academics', academics.changed);
  if (academics.reasons.length > 0) reasons.academics = academics.reasons.join('; ');

  return { done, skipped, reasons };
}

/**
 * The academics part of the demo (academics spec section 11). Each piece is added only where the
 * school lacks it: a stream or room by name (ignoring case, archived ones included), the board's
 * starter subjects the school has no name for, a section by class and name in the current year
 * on the primary campus, and class subjects only for a class with no rows yet. Sections and
 * class subjects are left out for a class outside the profile range; sections wait for a
 * current year.
 */
async function demoAcademics(
  ctx: INestApplicationContext,
  actor: { tenantId: string; userId: null },
  campusId: string,
): Promise<{ changed: boolean; reasons: string[] }> {
  const profiles = ctx.get(ProfileService);
  const years = ctx.get(AcademicYearsService);
  const streamsService = ctx.get(StreamsService);
  const subjectsService = ctx.get(SubjectsService);
  const classSubjects = ctx.get(ClassSubjectsService);
  const roomsService = ctx.get(RoomsService);
  const sectionsService = ctx.get(SectionsService);
  let changed = false;
  const reasons: string[] = [];

  // Streams.
  const haveStreams = new Set(
    (await streamsService.list(actor)).streams.map((s) => nameKey(s.name)),
  );
  for (const name of DEMO_STREAMS) {
    if (haveStreams.has(nameKey(name))) continue;
    await streamsService.create(actor, createStreamRequestSchema.parse({ name }), CLI_META);
    changed = true;
  }
  const activeStreams = new Map(
    (await streamsService.list(actor)).streams
      .filter((s) => s.status === 'ACTIVE')
      .map((s) => [nameKey(s.name), s.id]),
  );

  // Rooms on the primary campus.
  const haveRooms = new Set(
    (await roomsService.list(actor, { campusId })).rooms.map((r) => nameKey(r.name)),
  );
  for (const room of DEMO_ROOMS) {
    if (haveRooms.has(nameKey(room.name))) continue;
    await roomsService.create(
      actor,
      createRoomRequestSchema.parse({ ...room, campusId }),
      CLI_META,
    );
    changed = true;
  }
  const activeRooms = new Map(
    (await roomsService.list(actor, { campusId, status: 'ACTIVE' })).rooms.map((r) => [
      nameKey(r.name),
      r.id,
    ]),
  );

  // The board's starter subjects the school does not have yet.
  const missingSubjects = (await subjectsService.starter(actor)).items.filter((i) => !i.exists);
  if (missingSubjects.length > 0) {
    await subjectsService.addStarter(
      actor,
      starterSubjectsRequestSchema.parse({
        items: missingSubjects.map(({ name, code, type }) => ({ name, code, type })),
      }),
      CLI_META,
    );
    changed = true;
  }

  const { lowestClass, highestClass } = await profiles.get(actor);
  const inRange = (level: ClassLevel) =>
    lowestClass !== null && highestClass !== null && isInRange(level, lowestClass, highestClass);
  const outside = [...new Set(DEMO_SECTIONS.map((s) => s.classLevel))].filter((l) => !inRange(l));
  if (outside.length > 0) {
    reasons.push(`Class ${outside.join(' and ')} is outside the school's class range`);
  }

  // Sections of the current year.
  const current = (await years.list(actor)).years.find((y) => y.status === 'CURRENT');
  if (!current) {
    reasons.push('Sections were not added: the school has no current year');
  } else {
    const have = new Set(
      (await sectionsService.list(actor, current.id, campusId)).sections.map(
        (s) => `${s.classLevel}|${nameKey(s.name)}`,
      ),
    );
    for (const section of DEMO_SECTIONS) {
      if (!inRange(section.classLevel)) continue;
      if (have.has(`${section.classLevel}|${nameKey(section.name)}`)) continue;
      const streamId = section.stream ? activeStreams.get(nameKey(section.stream)) : null;
      if (streamId === undefined) continue; // its stream was archived by the school
      await sectionsService.create(
        actor,
        createSectionRequestSchema.parse({
          academicYearId: current.id,
          campusId,
          classLevel: section.classLevel,
          name: section.name,
          capacity: 40,
          streamId,
          roomId: (section.room && activeRooms.get(nameKey(section.room))) ?? null,
        }),
        CLI_META,
      );
      changed = true;
    }
  }

  // Class subjects, only for a class without any.
  const activeSubjects = new Map(
    (await subjectsService.list(actor)).subjects
      .filter((s) => s.status === 'ACTIVE')
      .map((s) => [nameKey(s.name), s.id]),
  );
  const { classes } = await classSubjects.list(actor);
  for (const demo of DEMO_CLASS_SUBJECTS) {
    if (!inRange(demo.classLevel)) continue;
    if (classes.some((c) => c.classLevel === demo.classLevel && c.rows.length > 0)) continue;
    const rows: ClassSubjectRow[] = [];
    for (const row of demo.rows) {
      const subjectId = activeSubjects.get(nameKey(row.subject));
      const streamId = row.stream ? activeStreams.get(nameKey(row.stream)) : null;
      if (subjectId === undefined || streamId === undefined) continue;
      rows.push({ subjectId, streamId, kind: row.kind });
    }
    if (rows.length === 0) continue;
    await classSubjects.replace(actor, demo.classLevel, rows, CLI_META);
    changed = true;
  }

  return { changed, reasons };
}

/** Who ran the command; `os.userInfo()` throws when the uid has no passwd entry. */
function operatorName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER || process.env.USERNAME || 'unknown';
  }
}
