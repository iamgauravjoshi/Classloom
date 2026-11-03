import {
  type AcademicYear,
  type AcademicYearsResponse,
  checkTerms,
  type CreateAcademicYearRequest,
  defaultTerms,
  type TermDates,
  type TermsCheck,
  type UpdateAcademicYearRequest,
  yearLabel,
} from '@classloom/contracts';
import { type HttpException, Injectable, NotFoundException } from '@nestjs/common';

import { dbViolation, uniqueViolationProblem } from '../../core/prisma/constraint-problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import type { Prisma } from '../../generated/prisma/client';
import type { RequestAuth } from '../auth/request-auth';
import { AuditService } from '../iam/audit.service';
import type { SchoolMeta } from './profile.service';
import {
  AcademicTermsInvalidException,
  AcademicYearLabelTakenException,
  AcademicYearLockedException,
  AcademicYearOverlapException,
  AcademicYearPlannedExistsException,
} from './school-problems';

/** The member making the change, or the platform CLI (no user). */
type Actor = Pick<RequestAuth, 'tenantId'> & { userId: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const YEAR_INCLUDE = { terms: { orderBy: { seq: 'asc' } } } as const;
type YearRow = Prisma.AcademicYearGetPayload<{ include: typeof YEAR_INCLUDE }>;

const TERM_MESSAGES: Record<Exclude<TermsCheck, { ok: true }>['problem'], string> = {
  count: 'A year has 2 or 3 terms.',
  start: "The first term must start on the year's start date.",
  gap: 'Each term must start the day after the previous term ends.',
  order: 'A term must end on or after the day it starts.',
  end: "The last term must end on the year's end date.",
};

/** `YYYY-MM-DD` to the UTC midnight Prisma writes to a `date` column, and back. */
const toDate = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);
const fromDate = (date: Date): string => date.toISOString().slice(0, 10);

function toYear(row: YearRow): AcademicYear {
  return {
    id: row.id,
    label: row.label,
    startsOn: fromDate(row.startsOn),
    endsOn: fromDate(row.endsOn),
    status: row.status,
    terms: row.terms.map((t) => ({
      id: t.id,
      seq: t.seq,
      name: t.name,
      startsOn: fromDate(t.startsOn),
      endsOn: fromDate(t.endsOn),
    })),
  };
}

/** Throws 422 `academic-terms-invalid` (with the failing index) unless the terms tile the year. */
function assertTermsTile(year: { startsOn: string; endsOn: string }, terms: TermDates[]): void {
  const check = checkTerms(year, terms);
  if (!check.ok) {
    throw new AcademicTermsInvalidException(
      check.problem === 'count' ? null : check.index,
      TERM_MESSAGES[check.problem],
    );
  }
}

const termValues = (terms: TermDates[]) =>
  terms.map(({ name, startsOn, endsOn }) => ({ name, startsOn, endsOn }));

/**
 * Academic years and their terms (onboarding spec sections 4 and 6). Every write runs in one
 * `withTenant` transaction holding the school's year lock, writes the year and its terms together
 * and records exactly one audit event.
 */
@Injectable()
export class AcademicYearsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** All of the school's years, newest first, with their terms in order. */
  list(auth: Actor): Promise<AcademicYearsResponse> {
    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      const rows = await tx.academicYear.findMany({
        include: YEAR_INCLUDE,
        orderBy: { startsOn: 'desc' },
      });
      return { years: rows.map(toYear) };
    });
  }

  /**
   * Creates a year with its terms (the given ones, or `termCount` default terms). It is `CURRENT`
   * when the school has no current year, otherwise `PLANNED`; the database refuses a second
   * planned year, an overlap and a taken label.
   */
  create(auth: Actor, input: CreateAcademicYearRequest, meta: SchoolMeta): Promise<AcademicYear> {
    const terms = input.terms ?? this.defaults(input.startsOn, input.endsOn, input.termCount ?? 3);
    assertTermsTile(input, terms);
    const label = input.label ?? yearLabel(input.startsOn, input.endsOn);

    return this.write(auth, async (tx) => {
      await lockYears(tx, auth.tenantId);
      const hasCurrent = (await tx.academicYear.count({ where: { status: 'CURRENT' } })) > 0;
      const status = hasCurrent ? 'PLANNED' : 'CURRENT';
      const row = await tx.academicYear.create({
        data: {
          tenantId: auth.tenantId,
          label,
          startsOn: toDate(input.startsOn),
          endsOn: toDate(input.endsOn),
          status,
        },
      });
      await this.writeTerms(tx, auth.tenantId, row.id, terms);
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'academic_year.created',
        targetType: 'academic_year',
        targetId: row.id,
        after: {
          label,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          status,
          terms: termValues(terms),
        },
        actor: auth,
        meta,
      });
      return toYear(await this.load(tx, row.id));
    });
  }

  /**
   * Replaces the dates and terms (and the label, when sent; otherwise it is kept). Refused for a
   * `CLOSED` year. No change writes nothing; otherwise one `academic_year.updated` event holds
   * only the changed fields.
   */
  update(
    auth: Actor,
    id: string,
    input: UpdateAcademicYearRequest,
    meta: SchoolMeta,
  ): Promise<AcademicYear> {
    return this.write(auth, async (tx) => {
      await lockYears(tx, auth.tenantId);
      const current = toYear(await this.load(tx, id));
      if (current.status === 'CLOSED') throw new AcademicYearLockedException();
      assertTermsTile(input, input.terms);

      const next = {
        label: input.label ?? current.label,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        terms: termValues(input.terms),
      };
      const previous = {
        label: current.label,
        startsOn: current.startsOn,
        endsOn: current.endsOn,
        terms: termValues(current.terms),
      };
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of ['label', 'startsOn', 'endsOn', 'terms'] as const) {
        if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
          before[key] = previous[key];
          after[key] = next[key];
        }
      }
      if (Object.keys(after).length === 0) return current;

      await tx.academicYear.update({
        where: { id },
        data: { label: next.label, startsOn: toDate(next.startsOn), endsOn: toDate(next.endsOn) },
      });
      if ('terms' in after) {
        await tx.academicTerm.deleteMany({ where: { academicYearId: id } });
        await this.writeTerms(tx, auth.tenantId, id, next.terms);
      }
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'academic_year.updated',
        targetType: 'academic_year',
        targetId: id,
        before: before as Prisma.InputJsonObject,
        after: after as Prisma.InputJsonObject,
        actor: auth,
        meta,
      });
      return toYear(await this.load(tx, id));
    });
  }

  /**
   * The planned year becomes `CURRENT` and the previous current year `CLOSED`. The status is read
   * only after the school's years are locked, so of two simultaneous calls the second sees a
   * `CURRENT` year and gets 409 `academic-year-locked`. The old year is closed first: the partial
   * unique index allows one current year at a time.
   */
  makeCurrent(auth: Actor, id: string, meta: SchoolMeta): Promise<AcademicYear> {
    return this.write(auth, async (tx) => {
      await lockYears(tx, auth.tenantId);
      const target = await this.load(tx, id);
      if (target.status !== 'PLANNED') throw new AcademicYearLockedException();
      const previous = await tx.academicYear.findFirst({
        where: { status: 'CURRENT' },
        select: { id: true },
      });
      if (previous) {
        await tx.academicYear.update({ where: { id: previous.id }, data: { status: 'CLOSED' } });
      }
      await tx.academicYear.update({ where: { id }, data: { status: 'CURRENT' } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'academic_year.made_current',
        targetType: 'academic_year',
        targetId: id,
        before: { currentYearId: previous?.id ?? null, plannedYearId: id },
        after: { currentYearId: id, closedYearId: previous?.id ?? null },
        actor: auth,
        meta,
      });
      return toYear(await this.load(tx, id));
    });
  }

  /** Deletes a `PLANNED` year; its terms cascade. Any other status gets 409. */
  remove(auth: Actor, id: string, meta: SchoolMeta): Promise<void> {
    return this.write(auth, async (tx) => {
      await lockYears(tx, auth.tenantId);
      const year = toYear(await this.load(tx, id));
      if (year.status !== 'PLANNED') throw new AcademicYearLockedException();
      await tx.academicYear.delete({ where: { id } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'academic_year.deleted',
        targetType: 'academic_year',
        targetId: id,
        before: {
          label: year.label,
          startsOn: year.startsOn,
          endsOn: year.endsOn,
          status: year.status,
          terms: termValues(year.terms),
        },
        actor: auth,
        meta,
      });
    });
  }

  private defaults(startsOn: string, endsOn: string, count: 2 | 3): TermDates[] {
    // The request schema holds the year to 180-400 days (yearLengthOk): always 3+ months.
    try {
      return defaultTerms(startsOn, endsOn, count);
    } catch (error) {
      if (error instanceof RangeError) throw new AcademicTermsInvalidException(null);
      throw error;
    }
  }

  private async writeTerms(
    tx: Prisma.TransactionClient,
    tenantId: string,
    academicYearId: string,
    terms: TermDates[],
  ): Promise<void> {
    await tx.academicTerm.createMany({
      data: terms.map((t, i) => ({
        tenantId,
        academicYearId,
        seq: i + 1,
        name: t.name,
        startsOn: toDate(t.startsOn),
        endsOn: toDate(t.endsOn),
      })),
    });
  }

  /** The year in the current school (row-level security narrows the query), or 404. */
  private async load(tx: Prisma.TransactionClient, id: string): Promise<YearRow> {
    const row = UUID.test(id)
      ? await tx.academicYear.findUnique({ where: { id }, include: YEAR_INCLUDE })
      : null;
    if (!row) throw new NotFoundException('Academic year not found');
    return row;
  }

  /** One transaction scoped to the caller's school, turning constraint violations into 409s. */
  private async write<T>(
    auth: Actor,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await withTenant(this.prisma, auth.tenantId, fn);
    } catch (error) {
      throw yearWriteProblem(error) ?? error;
    }
  }
}

/**
 * Serialises every change to one school's years: a transaction-scoped advisory lock (which also
 * covers a school with no years yet, so two first years cannot both become current), then a row
 * lock on the school's existing years.
 */
async function lockYears(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`academic_years:${tenantId}`}, 0))`;
  await tx.$executeRaw`SELECT id FROM academic_years WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`;
}

/** The unique indexes of `academic_years` this service maps, by name (see the migration). */
const UNIQUE_PROBLEMS = [
  ['academic_years_one_planned', () => new AcademicYearPlannedExistsException()],
  ['academic_years_label_key', () => new AcademicYearLabelTakenException()],
] as const;

/**
 * The problem for a database error from writing a year, or null when it is not one of ours.
 * `23P01` (the `academic_years_no_overlap` exclusion) is an overlap; a `23505` is matched by
 * constraint name (`uniqueViolationProblem`).
 */
export function yearWriteProblem(error: unknown): HttpException | null {
  if (dbViolation(error)?.sqlState === '23P01') return new AcademicYearOverlapException();
  return uniqueViolationProblem(error, UNIQUE_PROBLEMS);
}
