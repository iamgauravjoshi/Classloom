import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Series keys and defaults (Part 6a spec §3)                          */
/* ------------------------------------------------------------------ */

export const NUMBER_SERIES_KEYS = ['ENQUIRY', 'APPLICATION', 'ADMISSION', 'FEE_RECEIPT'] as const;
export type NumberSeriesKey = (typeof NUMBER_SERIES_KEYS)[number];

export const NUMBER_SERIES_RESETS = ['ACADEMIC_YEAR', 'NEVER'] as const;
export type NumberSeriesReset = (typeof NUMBER_SERIES_RESETS)[number];

export const DEFAULT_SERIES: Record<
  NumberSeriesKey,
  { pattern: string; reset: NumberSeriesReset }
> = {
  ENQUIRY: { pattern: 'ENQ/{AY}/{SEQ:4}', reset: 'ACADEMIC_YEAR' },
  APPLICATION: { pattern: 'APP/{AY}/{SEQ:4}', reset: 'ACADEMIC_YEAR' },
  ADMISSION: { pattern: '{SEQ:5}', reset: 'NEVER' },
  FEE_RECEIPT: { pattern: 'REC/{AY}/{SEQ:5}', reset: 'ACADEMIC_YEAR' },
};

/** The largest sequence a series can issue. */
export const MAX_SEQUENCE = 99_999_999;

/* ------------------------------------------------------------------ */
/* Pattern parsing and formatting                                      */
/* ------------------------------------------------------------------ */

export type PatternPart =
  | { kind: 'literal'; text: string }
  | { kind: 'year'; format: 'AY' | 'YYYY' | 'YY' }
  | { kind: 'seq'; width: number };

export const PATTERN_PROBLEMS = [
  'empty',
  'too-long',
  'bad-character',
  'unknown-token',
  'seq-missing',
  'seq-repeated',
  'seq-width',
  /** Not from `parseNumberPattern`: the API refuses an `ACADEMIC_YEAR` series without a year token. */
  'year-token-required',
] as const;
export type PatternProblem = (typeof PATTERN_PROBLEMS)[number];

export const MAX_PATTERN_LENGTH = 40;

const LITERAL_CHAR = /^[A-Za-z0-9/_ -]$/;

export function parseNumberPattern(
  pattern: string,
): { ok: true; parts: PatternPart[] } | { ok: false; problem: PatternProblem } {
  if (pattern.length === 0) return { ok: false, problem: 'empty' };
  if (pattern.length > MAX_PATTERN_LENGTH) return { ok: false, problem: 'too-long' };

  const parts: PatternPart[] = [];
  let literal = '';
  let seqCount = 0;
  const flush = () => {
    if (literal) parts.push({ kind: 'literal', text: literal });
    literal = '';
  };

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern.charAt(i);
    if (ch === '{') {
      const end = pattern.indexOf('}', i);
      if (end === -1) return { ok: false, problem: 'unknown-token' };
      const token = pattern.slice(i + 1, end);
      flush();
      if (token === 'AY' || token === 'YYYY' || token === 'YY') {
        parts.push({ kind: 'year', format: token });
      } else if (token.startsWith('SEQ:') && /^\d+$/.test(token.slice(4))) {
        const width = Number(token.slice(4));
        if (width < 1 || width > 8) return { ok: false, problem: 'seq-width' };
        seqCount += 1;
        if (seqCount > 1) return { ok: false, problem: 'seq-repeated' };
        parts.push({ kind: 'seq', width });
      } else {
        return { ok: false, problem: 'unknown-token' };
      }
      i = end;
    } else if (LITERAL_CHAR.test(ch)) {
      literal += ch;
    } else {
      return { ok: false, problem: 'bad-character' };
    }
  }
  flush();

  if (seqCount === 0) return { ok: false, problem: 'seq-missing' };
  return { ok: true, parts };
}

export function hasYearToken(parts: readonly PatternPart[]): boolean {
  return parts.some((p) => p.kind === 'year');
}

const twoDigits = (n: number) => String(n % 100).padStart(2, '0');

/** Formats one number. `yearStart` is the academic year's start year, e.g. 2026. */
export function formatNumber(
  parts: readonly PatternPart[],
  value: { yearStart: number; sequence: number },
): string {
  return parts
    .map((p) => {
      if (p.kind === 'literal') return p.text;
      if (p.kind === 'seq') return String(value.sequence).padStart(p.width, '0');
      if (p.format === 'YYYY') return String(value.yearStart);
      if (p.format === 'YY') return twoDigits(value.yearStart);
      return `${value.yearStart}-${twoDigits(value.yearStart + 1)}`;
    })
    .join('');
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

export const numberSeriesSchema = z.object({
  key: z.enum(NUMBER_SERIES_KEYS),
  name: z.string(),
  pattern: z.string(),
  reset: z.enum(NUMBER_SERIES_RESETS),
  nextNumber: z.number().int().min(1),
  preview: z.string().nullable(),
});
export type NumberSeries = z.infer<typeof numberSeriesSchema>;

export const numberSeriesListSchema = z.object({ series: z.array(numberSeriesSchema) });
export type NumberSeriesList = z.infer<typeof numberSeriesListSchema>;

export const updateNumberSeriesRequestSchema = z
  .object({
    pattern: z.string().max(200).optional(),
    reset: z.enum(NUMBER_SERIES_RESETS).optional(),
    nextNumber: z.number().int().min(1).max(MAX_SEQUENCE).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Change at least one field',
  });
export type UpdateNumberSeriesRequest = z.infer<typeof updateNumberSeriesRequestSchema>;
