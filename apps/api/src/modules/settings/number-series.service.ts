import {
  formatNumber,
  hasYearToken,
  MAX_SEQUENCE,
  NUMBER_SERIES_KEYS,
  type NumberSeries,
  type NumberSeriesKey,
  type NumberSeriesList,
  type NumberSeriesReset,
  parseNumberPattern,
  type UpdateNumberSeriesRequest,
} from '@classloom/contracts';
import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import type { Prisma } from '../../generated/prisma/client';
import type { Actor, AuditMeta, JsonFields } from '../academics/academics-write';
import { AuditService } from '../iam/audit.service';
import {
  NextNumberTooLowException,
  NoCurrentYearException,
  NumberPatternInvalidException,
  NumberSeriesExhausted,
} from './settings-problems';

export { NumberSeriesExhausted } from './settings-problems';

const NAMES: Record<NumberSeriesKey, string> = {
  ENQUIRY: 'Enquiry',
  APPLICATION: 'Application',
  ADMISSION: 'Admission',
  FEE_RECEIPT: 'Fee receipt',
};

/** The counter period of a series that never resets. */
const ALL = 'ALL';

/** An academic year as `next()` and the preview need it: its id and `YYYY-MM-DD` start date. */
export interface SeriesYear {
  id: string;
  startsOn: string;
}

interface SeriesRow {
  pattern: string;
  reset: NumberSeriesReset;
}

const isKey = (key: string): key is NumberSeriesKey =>
  (NUMBER_SERIES_KEYS as readonly string[]).includes(key);

/** The counter period for a reset rule: the year's id, or `'ALL'`; null for a per-year series without a year. */
function periodOf(reset: NumberSeriesReset, year: SeriesYear | null): string | null {
  if (reset === 'NEVER') return ALL;
  return year ? year.id.toLowerCase() : null;
}

const yearStartOf = (year: SeriesYear): number => Number(year.startsOn.slice(0, 4));

/** The series row, locked: `SHARE` for issuing numbers, `UPDATE` for changing the series. */
async function lockSeries(
  tx: Prisma.TransactionClient,
  key: NumberSeriesKey,
  mode: 'SHARE' | 'UPDATE',
): Promise<SeriesRow | null> {
  const rows =
    mode === 'SHARE'
      ? await tx.$queryRaw<SeriesRow[]>`
          SELECT pattern, reset::text AS reset FROM number_series
           WHERE tenant_id = current_setting('app.tenant_id')::uuid
             AND key = ${key}::"NumberSeriesKey"
             FOR SHARE`
      : await tx.$queryRaw<SeriesRow[]>`
          SELECT pattern, reset::text AS reset FROM number_series
           WHERE tenant_id = current_setting('app.tenant_id')::uuid
             AND key = ${key}::"NumberSeriesKey"
             FOR UPDATE`;
  return rows[0] ?? null;
}

/** The last value of one counter, 0 when it has issued nothing. */
async function lastValue(
  tx: Prisma.TransactionClient,
  key: NumberSeriesKey,
  period: string,
): Promise<number> {
  const row = await tx.numberSeriesCounter.findFirst({
    where: { key, period },
    select: { lastValue: true },
  });
  return row ? Number(row.lastValue) : 0;
}

/** The highest number the series has issued in any period, 0 when none. */
async function highestIssued(tx: Prisma.TransactionClient, key: NumberSeriesKey): Promise<number> {
  const agg = await tx.numberSeriesCounter.aggregate({
    where: { key },
    _max: { lastValue: true },
  });
  return Number(agg._max.lastValue ?? 0);
}

/** The school's `CURRENT` year, or null. */
async function currentYear(tx: Prisma.TransactionClient): Promise<SeriesYear | null> {
  const row = await tx.academicYear.findFirst({
    where: { status: 'CURRENT' },
    select: { id: true, startsOn: true },
  });
  return row ? { id: row.id, startsOn: row.startsOn.toISOString().slice(0, 10) } : null;
}

function toSeries(
  key: NumberSeriesKey,
  row: SeriesRow,
  year: SeriesYear | null,
  last: number,
): NumberSeries {
  const nextNumber = last + 1;
  const parsed = parseNumberPattern(row.pattern);
  return {
    key,
    name: NAMES[key],
    pattern: row.pattern,
    reset: row.reset,
    nextNumber,
    preview:
      year && parsed.ok
        ? formatNumber(parsed.parts, { yearStart: yearStartOf(year), sequence: nextNumber })
        : null,
  };
}

/**
 * Number series (Part 6a spec section 3): how enquiry, application, admission and receipt numbers
 * are formatted, and the counters that issue them.
 *
 * Locking: `next()` holds the series row `FOR SHARE` and increments its counter with an upsert,
 * whose row lock serialises concurrent callers; a change to the series holds the row `FOR UPDATE`,
 * so it never interleaves with an allocation and its counter reads stay true until it commits.
 */
@Injectable()
export class NumberSeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Issues the series' next number in the caller's transaction (`tx` from `withTenant`): if that
   * transaction rolls back, so does the counter, and the number is issued again. The period is the
   * year's id for a per-year series, else `'ALL'`. Throws `NumberSeriesExhausted` past 99,999,999.
   *
   * `year` is the caller's: the year the record being numbered belongs to (and whose start year
   * the pattern prints), not necessarily the school's current year. The series row stays locked
   * `FOR SHARE` until the caller's transaction ends, so a change to the series waits for it; keep
   * that transaction short.
   */
  async next(
    tx: Prisma.TransactionClient,
    key: NumberSeriesKey,
    year: SeriesYear,
  ): Promise<{ value: string; sequence: number }> {
    if (!year?.id || !year.startsOn) throw new Error('next() needs an academic year');
    const series = await lockSeries(tx, key, 'SHARE');
    if (!series) throw new Error(`The school has no ${key} number series`);
    const parsed = parseNumberPattern(series.pattern);
    if (!parsed.ok) throw new Error(`The ${key} number series has an invalid pattern`);
    const period = periodOf(series.reset, year) as string;

    const rows = await tx.$queryRaw<{ last_value: bigint }[]>`
      INSERT INTO number_series_counters (tenant_id, key, period, last_value)
      VALUES (current_setting('app.tenant_id')::uuid, ${key}::"NumberSeriesKey", ${period}, 1)
      ON CONFLICT (tenant_id, key, period)
      DO UPDATE SET last_value = number_series_counters.last_value + 1, updated_at = now()
      RETURNING last_value`;
    const sequence = Number(rows[0]!.last_value);
    if (sequence < 1 || sequence > MAX_SEQUENCE) throw new NumberSeriesExhausted(key);
    return {
      value: formatNumber(parsed.parts, { yearStart: yearStartOf(year), sequence }),
      sequence,
    };
  }

  /** The four series in key order, each with its next number and preview for the current year. */
  list(auth: Actor): Promise<NumberSeriesList> {
    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      const year = await currentYear(tx);
      const rows = await tx.numberSeries.findMany({
        select: { key: true, pattern: true, reset: true },
      });
      const periods = year ? [ALL, year.id.toLowerCase()] : [ALL];
      const counters = await tx.numberSeriesCounter.findMany({
        where: { period: { in: periods } },
        select: { key: true, period: true, lastValue: true },
      });
      const series: NumberSeries[] = [];
      for (const key of NUMBER_SERIES_KEYS) {
        const row = rows.find((r) => r.key === key);
        if (!row) continue;
        const period = periodOf(row.reset, year);
        const counter = counters.find((c) => c.key === key && c.period === period);
        series.push(toSeries(key, row, year, counter ? Number(counter.lastValue) : 0));
      }
      return { series };
    });
  }

  /**
   * Changes the pattern, the reset rule or the next number of one series, with one
   * `number_series.updated` audit row (the key and the changed fields); no change writes nothing.
   *
   * An `ACADEMIC_YEAR` series needs a year token (422 `number-pattern-invalid`,
   * `year-token-required`). Switching the reset rule never lets a number repeat: to `NEVER`, the
   * overall counter starts at the highest number issued in any period; to `ACADEMIC_YEAR`, the
   * current year's counter starts at least at the overall counter (409 `no-current-year` when there
   * is no current year and the overall counter has issued numbers). `nextNumber` applies to the
   * period of the (new) reset rule for the current year and must be above its last value.
   */
  update(
    auth: Actor,
    rawKey: string,
    input: UpdateNumberSeriesRequest,
    meta: AuditMeta,
  ): Promise<NumberSeries> {
    if (!isKey(rawKey)) throw new NotFoundException('Number series not found');
    const key = rawKey;
    if (input.pattern !== undefined) {
      const parsed = parseNumberPattern(input.pattern);
      if (!parsed.ok) throw new NumberPatternInvalidException(parsed.problem);
    }

    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      const current = await lockSeries(tx, key, 'UPDATE');
      if (!current) throw new NotFoundException('Number series not found');
      const year = await currentYear(tx);
      const pattern = input.pattern ?? current.pattern;
      const reset = input.reset ?? current.reset;

      const oldPeriod = periodOf(current.reset, year);
      const oldLast = oldPeriod ? await lastValue(tx, key, oldPeriod) : 0;
      const period = periodOf(reset, year);
      let last = period ? await lastValue(tx, key, period) : 0;
      // The counter's new last value, when it changes.
      let setLast: number | null = null;

      // A yearly series restarts each year, so its numbers must carry the year to stay unique.
      if ((input.pattern !== undefined || input.reset !== undefined) && reset === 'ACADEMIC_YEAR') {
        const parsed = parseNumberPattern(pattern);
        if (!(parsed.ok && hasYearToken(parsed.parts))) {
          throw new NumberPatternInvalidException('year-token-required');
        }
      }

      // Switching never lets a number repeat, even after a round trip between the rules.
      if (reset !== current.reset) {
        const floor =
          reset === 'NEVER' ? await highestIssued(tx, key) : await lastValue(tx, key, ALL);
        if (reset === 'ACADEMIC_YEAR' && !period && floor > 0) throw new NoCurrentYearException();
        if (period && floor > last) {
          setLast = floor;
          last = floor;
        }
      }

      const before: JsonFields = {};
      const after: JsonFields = {};
      if (pattern !== current.pattern) {
        before.pattern = current.pattern;
        after.pattern = pattern;
      }
      if (reset !== current.reset) {
        before.reset = current.reset;
        after.reset = reset;
      }
      if (input.nextNumber !== undefined) {
        if (!period) throw new NoCurrentYearException();
        if (input.nextNumber <= last) throw new NextNumberTooLowException(last + 1);
        if (input.nextNumber !== last + 1) {
          before.nextNumber = oldLast + 1;
          after.nextNumber = input.nextNumber;
          setLast = input.nextNumber - 1;
          last = setLast;
        }
      }

      if (Object.keys(after).length === 0) return toSeries(key, current, year, oldLast);

      if (pattern !== current.pattern || reset !== current.reset) {
        await tx.numberSeries.update({
          where: { tenantId_key: { tenantId: auth.tenantId, key } },
          data: { pattern, reset },
        });
      }
      if (setLast !== null && period) {
        await tx.numberSeriesCounter.upsert({
          where: { tenantId_key_period: { tenantId: auth.tenantId, key, period } },
          create: { tenantId: auth.tenantId, key, period, lastValue: BigInt(setLast) },
          update: { lastValue: BigInt(setLast) },
        });
      }
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'number_series.updated',
        targetType: 'number_series',
        targetId: auth.tenantId,
        before: { key, ...before },
        after: { key, ...after },
        actor: auth,
        meta,
      });
      return toSeries(key, { pattern, reset }, year, last);
    });
  }
}
