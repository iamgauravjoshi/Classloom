import {
  checkTerms,
  defaultTerms,
  type TermDates,
  yearLabel,
  yearLengthOk,
} from '@classloom/contracts';

/*
 * The academic-year form's pure rules. The form holds every date as the DD/MM/YYYY text a person
 * types; these helpers read it, regenerate the default terms and check the year before it is sent.
 */

/** `YYYY-MM-DD` shown as `DD/MM/YYYY`. */
export function formatYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * `D/M/YYYY` or `DD/MM/YYYY` read as `YYYY-MM-DD`; null unless it is a real calendar day. The
 * date fields open a numeric keypad, which has no "/" on some phones, so `-` and `.` separate
 * too, and eight digits alone are read as DDMMYYYY.
 */
export function parseDisplayDate(text: string): string | null {
  const trimmed = text.trim();
  const separated = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/.exec(trimmed);
  const digits = /^(\d{2})(\d{2})(\d{4})$/.exec(trimmed);
  const parts = separated
    ? [separated[1], separated[3], separated[4]]
    : digits
      ? [digits[1], digits[2], digits[3]]
      : null;
  if (!parts) return null;
  const [d, m, y] = parts.map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export interface TermRow {
  name: string;
  /** DD/MM/YYYY as typed. */
  startsOn: string;
  endsOn: string;
}

export interface YearFormState {
  /** DD/MM/YYYY as typed. */
  startsOn: string;
  endsOn: string;
  termCount: 2 | 3;
  terms: TermRow[];
  /** A term row was changed by hand: regenerating would lose that, so the form asks first. */
  termsEdited: boolean;
  label: string;
  /** The label was typed by hand; otherwise it follows the dates and is not sent. */
  labelEdited: boolean;
}

export type YearFormChange = { startsOn: string } | { endsOn: string } | { termCount: 2 | 3 };

const toRow = (term: TermDates): TermRow => ({
  name: term.name,
  startsOn: formatYmd(term.startsOn),
  endsOn: formatYmd(term.endsOn),
});

/** The automatic label for the typed dates, or '' while they can't be read. */
function autoLabel(startsOn: string, endsOn: string): string {
  const start = parseDisplayDate(startsOn);
  const end = parseDisplayDate(endsOn);
  return start && end && end > start ? yearLabel(start, end) : '';
}

/** The default terms for the typed dates, keeping names a person typed; null if not possible. */
function generatedTerms(state: YearFormState): TermRow[] | null {
  const start = parseDisplayDate(state.startsOn);
  const end = parseDisplayDate(state.endsOn);
  if (!start || !end) return null;
  try {
    return defaultTerms(start, end, state.termCount).map((term, i) => {
      const typed = state.terms[i]?.name.trim();
      return toRow(typed ? { ...term, name: state.terms[i]!.name } : term);
    });
  } catch {
    return null;
  }
}

/** Rows resized to the count, for when the dates can't be split yet. */
function resized(terms: TermRow[], count: 2 | 3): TermRow[] {
  const rows = terms.slice(0, count);
  while (rows.length < count) {
    rows.push({ name: `Term ${rows.length + 1}`, startsOn: '', endsOn: '' });
  }
  return rows;
}

/** Whether saved terms have the default dates for their year and count (names don't matter). */
function isDefaultSplit(startsOn: string, endsOn: string, terms: TermDates[]): boolean {
  if (terms.length !== 2 && terms.length !== 3) return false;
  try {
    const defaults = defaultTerms(startsOn, endsOn, terms.length);
    return defaults.every(
      (term, i) => term.startsOn === terms[i]?.startsOn && term.endsOn === terms[i]?.endsOn,
    );
  } catch {
    return false;
  }
}

/** The form's first state: a year's own values, or default terms for the given dates. */
export function initialYearFormState(initial: {
  startsOn: string;
  endsOn: string;
  label?: string;
  terms?: TermDates[];
}): YearFormState {
  const startsOn = formatYmd(initial.startsOn);
  const endsOn = formatYmd(initial.endsOn);
  const automatic = yearLabel(initial.startsOn, initial.endsOn);
  const label = initial.label ?? automatic;
  const base: YearFormState = {
    startsOn,
    endsOn,
    termCount: initial.terms?.length === 3 ? 3 : 2,
    terms: (initial.terms ?? []).map(toRow),
    termsEdited: false,
    label,
    labelEdited: label !== automatic,
  };
  if (initial.terms && initial.terms.length > 0) {
    // A saved split that isn't the default counts as edited: changing the dates asks first.
    return {
      ...base,
      termsEdited: !isDefaultSplit(initial.startsOn, initial.endsOn, initial.terms),
    };
  }
  return { ...base, terms: generatedTerms(base) ?? resized([], 2) };
}

/**
 * A start date, end date or term count change. Untouched terms are regenerated from the new values;
 * edited ones are kept and `needsConfirm` says the form should ask before replacing them
 * (`termsAfterConfirm`). While the dates can't be split the terms are left alone.
 */
export function formStateAfterDateChange(
  state: YearFormState,
  change: YearFormChange,
): { state: YearFormState; needsConfirm: boolean } {
  let next: YearFormState = { ...state, ...change };
  if (!next.labelEdited) next = { ...next, label: autoLabel(next.startsOn, next.endsOn) };
  const generated = generatedTerms(next);
  if (!generated) {
    return {
      state: 'termCount' in change ? { ...next, terms: resized(next.terms, next.termCount) } : next,
      needsConfirm: false,
    };
  }
  if (next.termsEdited) return { state: next, needsConfirm: true };
  return { state: { ...next, terms: generated }, needsConfirm: false };
}

/** The person agreed to replace their edited terms with the defaults. */
export function termsAfterConfirm(state: YearFormState): YearFormState {
  const generated = generatedTerms(state);
  return generated ? { ...state, terms: generated, termsEdited: false } : state;
}

/** The person kept their edited terms: the count goes back to the rows they have. */
export function termsKept(state: YearFormState): YearFormState {
  return { ...state, termCount: state.terms.length === 3 ? 3 : 2 };
}

export type DateProblem = 'date' | 'order' | 'length';
export type TermProblem = 'date' | 'name' | 'start' | 'gap' | 'order' | 'end';

export interface YearFormErrors {
  startsOn?: DateProblem;
  /** The count was changed but the rows were not replaced yet (the replace question is open). */
  termCount?: 'unanswered';
  endsOn?: DateProblem;
  label?: 'label';
  terms?: Record<number, { name?: TermProblem; startsOn?: TermProblem; endsOn?: TermProblem }>;
}

export interface YearBody {
  label?: string;
  startsOn: string;
  endsOn: string;
  terms: TermDates[];
}

/** The create or update body, or the problem on each failing field (a term's on its row). */
export function validateYearForm(
  state: YearFormState,
): { ok: true; body: YearBody } | { ok: false; errors: YearFormErrors } {
  const errors: YearFormErrors = {};
  const start = parseDisplayDate(state.startsOn);
  const end = parseDisplayDate(state.endsOn);
  if (!start) errors.startsOn = 'date';
  if (!end) errors.endsOn = 'date';
  else if (start && end <= start) errors.endsOn = 'order';
  else if (start && !yearLengthOk(start, end)) errors.endsOn = 'length';

  if (state.termCount !== state.terms.length) errors.termCount = 'unanswered';

  const label = state.label.trim();
  if (state.labelEdited && (label.length === 0 || label.length > 20)) errors.label = 'label';

  const termErrors: NonNullable<YearFormErrors['terms']> = {};
  const terms: TermDates[] = state.terms.map((row, i) => {
    const rowStart = parseDisplayDate(row.startsOn);
    const rowEnd = parseDisplayDate(row.endsOn);
    const name = row.name.trim();
    const problems: NonNullable<YearFormErrors['terms']>[number] = {};
    if (name.length === 0 || name.length > 40) problems.name = 'name';
    if (!rowStart) problems.startsOn = 'date';
    if (!rowEnd) problems.endsOn = 'date';
    if (Object.keys(problems).length > 0) termErrors[i] = problems;
    return { name, startsOn: rowStart ?? '', endsOn: rowEnd ?? '' };
  });

  // The tiling rule, once every date can be read: its problem goes on the failing row.
  if (start && end && Object.keys(termErrors).length === 0) {
    const check = checkTerms({ startsOn: start, endsOn: end }, terms);
    if (!check.ok && check.problem !== 'count') {
      const field = check.problem === 'start' || check.problem === 'gap' ? 'startsOn' : 'endsOn';
      termErrors[check.index] = { [field]: check.problem };
    }
  }
  if (Object.keys(termErrors).length > 0) errors.terms = termErrors;

  if (Object.keys(errors).length > 0 || !start || !end) return { ok: false, errors };
  return {
    ok: true,
    body: {
      ...(state.labelEdited ? { label } : {}),
      startsOn: start,
      endsOn: end,
      terms,
    },
  };
}

/** The day after a DD/MM/YYYY date, as DD/MM/YYYY; null unless the text is a real day. */
function nextDay(text: string): string | null {
  const ymd = parseDisplayDate(text);
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return formatYmd(next.toISOString().slice(0, 10));
}

/**
 * A change typed into a term row. A changed date marks the terms as edited; a complete end date
 * also moves the next term's start to the following day, so the terms keep tiling the year.
 */
export function stateAfterTermEdit(
  state: YearFormState,
  index: number,
  field: keyof TermRow,
  value: string,
): YearFormState {
  const terms = state.terms.map((row, i) => (i === index ? { ...row, [field]: value } : row));
  if (field === 'name') return { ...state, terms };
  const following = field === 'endsOn' ? nextDay(value) : null;
  if (following && terms[index + 1]) {
    terms[index + 1] = { ...terms[index + 1]!, startsOn: following };
  }
  return { ...state, terms, termsEdited: true };
}
