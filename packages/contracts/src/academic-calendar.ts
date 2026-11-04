/* Pure date rules on plain YYYY-MM-DD strings. Only UTC parts are used, never local time. */

const DAY_MS = 86_400_000;

type Ymd = { y: number; m: number; d: number };

function parse(s: string): Ymd {
  const [y, m, d] = s.split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const utc = (s: string) => {
  const { y, m, d } = parse(s);
  return Date.UTC(y, m - 1, d);
};

const fromUtc = (ms: number) => {
  const dt = new Date(ms);
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};

const addDays = (s: string, n: number) => fromUtc(utc(s) + n * DAY_MS);

/** Months since year 0, so month arithmetic is a plain integer. */
const monthIndex = ({ y, m }: Ymd) => y * 12 + (m - 1);

/** `start` plus `n` months, keeping its day of month (clamped to the month's length). */
function addMonths(start: string, n: number): string {
  const p = parse(start);
  const idx = monthIndex(p) + n;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return fmt(y, m, Math.min(p.d, dim));
}

/** Whole months from `startsOn` up to the day after `endsOn` (a partial month is dropped). */
function monthSpan(startsOn: string, endsOn: string): number {
  const s = parse(startsOn);
  const e = parse(addDays(endsOn, 1));
  return monthIndex(e) - monthIndex(s) - (e.d < s.d ? 1 : 0);
}

export type TermDates = { name: string; startsOn: string; endsOn: string };

/**
 * Splits the year's whole months as evenly as possible; earlier terms take the extra month.
 * Boundaries keep the start's day of month (15 Apr – 14 Apr gives 15 Apr – 14 Oct, 15 Oct – 14 Apr).
 * Term 1 starts on `startsOn` and the last term ends on `endsOn`.
 * Throws a RangeError when the year is shorter than `count` months.
 */
export function defaultTerms(startsOn: string, endsOn: string, count: 2 | 3): TermDates[] {
  const total = monthSpan(startsOn, endsOn);
  if (endsOn < startsOn || total < count) {
    throw new RangeError('The year is too short to split into terms');
  }
  const base = Math.floor(total / count);
  const extra = total % count;
  const terms: TermDates[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    cursor += base + (i < extra ? 1 : 0);
    const last = i === count - 1;
    terms.push({
      name: `Term ${i + 1}`,
      startsOn: i === 0 ? startsOn : addDays(terms[i - 1]!.endsOn, 1),
      endsOn: last ? endsOn : addDays(addMonths(startsOn, cursor), -1),
    });
  }
  return terms;
}

export type TermsCheck =
  { ok: true } | { ok: false; index: number; problem: 'count' | 'start' | 'gap' | 'order' | 'end' };

/** The tiling rule: 2–3 terms, from the year's start to its end with no gap or overlap. */
export function checkTerms(
  year: { startsOn: string; endsOn: string },
  terms: { startsOn: string; endsOn: string }[],
): TermsCheck {
  if (terms.length < 2 || terms.length > 3) return { ok: false, index: 0, problem: 'count' };
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i]!;
    if (i === 0 && t.startsOn !== year.startsOn) return { ok: false, index: i, problem: 'start' };
    if (t.endsOn < t.startsOn) return { ok: false, index: i, problem: 'order' };
    if (i > 0 && t.startsOn !== addDays(terms[i - 1]!.endsOn, 1)) {
      return { ok: false, index: i, problem: 'gap' };
    }
    if (i === terms.length - 1 && t.endsOn !== year.endsOn) {
      return { ok: false, index: i, problem: 'end' };
    }
  }
  return { ok: true };
}

/** "2026–27", or "2026" when both dates fall in one calendar year. */
export function yearLabel(startsOn: string, endsOn: string): string {
  const a = parse(startsOn).y;
  const b = parse(endsOn).y;
  if (a === b) return String(a);
  return `${a}–${String(b % 100).padStart(2, '0')}`;
}

/** The year runs 180 to 400 days (end minus start), both inclusive. */
export function yearLengthOk(startsOn: string, endsOn: string): boolean {
  const days = Math.round((utc(endsOn) - utc(startsOn)) / DAY_MS);
  return days >= 180 && days <= 400;
}

/** The day after `endsOn`, and the same number of months long. */
export function nextYearDates(current: { startsOn: string; endsOn: string }): {
  startsOn: string;
  endsOn: string;
} {
  const startsOn = addDays(current.endsOn, 1);
  const months = monthSpan(current.startsOn, current.endsOn);
  return { startsOn, endsOn: addDays(addMonths(startsOn, months), -1) };
}
