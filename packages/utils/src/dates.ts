const IST = 'Asia/Kolkata';

const istParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function partsOf(input: Date | string): { year: number; month: number; day: number } {
  const date = typeof input === 'string' ? new Date(input) : input;
  const parts = Object.fromEntries(istParts.formatToParts(date).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `DD/MM/YYYY` as seen on a wall clock in India. */
export function formatDateIN(input: Date | string): string {
  const { year, month, day } = partsOf(input);
  return `${pad(day)}/${pad(month)}/${year}`;
}

/** `YYYY-MM-DD` calendar date in India (for `date` columns and query params). */
export function toISTDateString(input: Date | string): string {
  const { year, month, day } = partsOf(input);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Academic year label such as `2026-27`; the year starts on the 1st of `startMonth` (April by default) in IST. */
export function academicYearOf(input: Date | string, startMonth = 4): string {
  const { year, month } = partsOf(input);
  const start = month >= startMonth ? year : year - 1;
  return `${start}-${pad((start + 1) % 100)}`;
}
