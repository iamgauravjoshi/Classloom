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

/** Last day of the month at `index` (see monthIndex). */
function lastDayOfMonth(index: number): string {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return fromUtc(Date.UTC(y, m, 0));
}

/** First day of the month at `index`. */
const firstDayOfMonth = (index: number) => fmt(Math.floor(index / 12), (index % 12) + 1, 1);

export type TermDates = { name: string; startsOn: string; endsOn: string };

/**
 * Splits the year's months as evenly as possible; earlier terms take the extra month.
 * Term 1 starts on `startsOn` and the last term ends on `endsOn`, whatever the day of month.
 */
export function defaultTerms(startsOn: string, endsOn: string, count: 2 | 3): TermDates[] {
  const start = parse(startsOn);
  const first = monthIndex(start);
  const total = monthIndex(parse(endsOn)) - first + 1;
  const base = Math.floor(total / count);
  const extra = total % count;
  const terms: TermDates[] = [];
  let cursor = first;
  for (let i = 0; i < count; i++) {
    const months = base + (i < extra ? 1 : 0);
    const last = i === count - 1;
    terms.push({
      name: `Term ${i + 1}`,
      startsOn: i === 0 ? startsOn : firstDayOfMonth(cursor),
      endsOn: last ? endsOn : lastDayOfMonth(cursor + months - 1),
    });
    cursor += months;
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
  const s = parse(startsOn);
  const months = monthIndex(parse(current.endsOn)) - monthIndex(parse(current.startsOn)) + 1;
  // The new year ends the day before the same day-of-month, `months` months later.
  const target = monthIndex(s) + months;
  const y = Math.floor(target / 12);
  const m = (target % 12) + 1;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const nextStart = fmt(y, m, Math.min(s.d, dim));
  return { startsOn, endsOn: addDays(nextStart, -1) };
}
