/** UDISE+ school code: 11 digits, the first two a state/UT code from 01 to 38. */
export function isValidUdise(s: string): boolean {
  if (!/^\d{11}$/.test(s)) return false;
  const state = Number(s.slice(0, 2));
  return state >= 1 && state <= 38;
}

/** Board affiliation number: 1–30 letters, digits, `/` and `-`. */
export function isValidAffiliationNumber(s: string): boolean {
  return /^[A-Za-z0-9/-]{1,30}$/.test(s);
}

/**
 * Normalises an Indian mobile or landline (with STD code) to `+91XXXXXXXXXX`.
 * Strips spaces, hyphens, `+91` and a leading `0`; needs 10 digits starting 1–9.
 */
export function normalizeIndianPhone(raw: string): string | null {
  let s = raw.replace(/[\s-]/g, '');
  if (s.startsWith('+91')) s = s.slice(3);
  else if (s.startsWith('0')) s = s.slice(1);
  return /^[1-9]\d{9}$/.test(s) ? `+91${s}` : null;
}
