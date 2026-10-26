/** Codes rejected so they stay safe as future subdomains and routes. */
export const RESERVED_SCHOOL_CODES: readonly string[] = [
  'ADMIN',
  'API',
  'APP',
  'WWW',
  'MAIL',
  'CLASSLOOM',
  'SUPPORT',
  'HELP',
  'STATUS',
  'DOCS',
  'BLOG',
  'STATIC',
  'ASSETS',
  'CDN',
  'TEST',
  'DEMO',
  'ROOT',
  'SYSTEM',
];

export type SchoolCodeProblem = 'invalid' | 'reserved';

export type SchoolCodeCheck =
  { ok: true; code: string } | { ok: false; code: string; problem: SchoolCodeProblem };

const MIN_LENGTH = 3;
const MAX_LENGTH = 12;
const SCHOOL_CODE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
const JOINING_WORDS = new Set(['of', 'the', 'and', '&']);
const SCH_FALLBACK = 'SCH';

/** Trims and uppercases a school code as typed. */
export function normaliseSchoolCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Checks format (3–12 characters, letters and digits, single hyphens between segments) and reserved words. */
export function validateSchoolCode(raw: string): SchoolCodeCheck {
  const code = normaliseSchoolCode(raw);
  if (code.length < MIN_LENGTH || code.length > MAX_LENGTH || !SCHOOL_CODE.test(code)) {
    return { ok: false, code, problem: 'invalid' };
  }
  if (RESERVED_SCHOOL_CODES.includes(code)) {
    return { ok: false, code, problem: 'reserved' };
  }
  return { ok: true, code };
}

/** ASCII letters of a string, uppercased, in order. Non-Latin text yields none. */
function asciiLetters(text: string): string[] {
  return (text.match(/[A-Za-z]/g) ?? []).map((letter) => letter.toUpperCase());
}

/**
 * Suggests a school code from the school name and city. The result always passes
 * `validateSchoolCode`.
 */
export function suggestSchoolCode(name: string, city: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '' && !JOINING_WORDS.has(word.toLowerCase()));
  const wordLetters = words.map(asciiLetters).filter((letters) => letters.length > 0);

  let letters: string[];
  if (wordLetters.length === 0) {
    letters = asciiLetters(city).slice(0, MIN_LENGTH);
    if (letters.length < MIN_LENGTH) return SCH_FALLBACK;
  } else {
    const initials = wordLetters.map((chars) => chars[0] ?? '');
    const cityInitial = asciiLetters(city)[0];
    letters = cityInitial ? [...initials, cityInitial] : initials;

    if (letters.length < MIN_LENGTH) {
      // Pad with the remaining letters of the name, starting with the first word,
      // inserted right after the first initial.
      const spare = wordLetters.flatMap((chars) => chars.slice(1));
      const needed = MIN_LENGTH - letters.length;
      letters.splice(1, 0, ...spare.slice(0, needed));
      if (letters.length < MIN_LENGTH) return SCH_FALLBACK;
    }
  }

  let code = letters.join('').slice(0, MAX_LENGTH);
  if (RESERVED_SCHOOL_CODES.includes(code)) {
    code = `${code.slice(0, MAX_LENGTH - 2)}-1`;
  }
  return code;
}
