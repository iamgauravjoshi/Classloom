/**
 * The year and campus a person has chosen to look at (spec §6, §7). They only choose what the
 * page shows, so they are plain cookies the browser writes: `Path=/`, `SameSite=Lax`, one year,
 * not httpOnly. A stale id (a deleted year, an inactive campus, another school's id after
 * switching schools) is ignored and the default is used instead; it is never shown.
 */
export type SelectionCookie = 'cl_year' | 'cl_campus';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** The cookie's year when the school has it, else the current year, else null. */
export function pickYear<T extends { id: string; status: string }>(
  years: readonly T[],
  cookie: string | undefined,
): T | null {
  const chosen = cookie ? years.find((year) => year.id === cookie) : undefined;
  return chosen ?? years.find((year) => year.status === 'CURRENT') ?? null;
}

/** The cookie's campus when it is listed and active, else the primary campus, else null. */
export function pickCampus<T extends { id: string; isPrimary: boolean; isActive: boolean }>(
  campuses: readonly T[],
  cookie: string | undefined,
): T | null {
  const chosen = cookie
    ? campuses.find((campus) => campus.id === cookie && campus.isActive)
    : undefined;
  return chosen ?? campuses.find((campus) => campus.isPrimary) ?? null;
}

/** Remembers a choice in the browser (client only). */
export function writeSelection(name: SelectionCookie, id: string): void {
  const secure = globalThis.location?.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(id)}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
}

/** The remembered choice, read from `document.cookie` (client only). */
export function readSelection(name: SelectionCookie): string | undefined {
  for (const part of document.cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}
