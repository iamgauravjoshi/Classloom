import { safeNextPath } from '@classloom/utils';

import { routing } from '@/i18n/routing';

/** Sections (the first segment after the locale) that anyone may open without signing in. */
const PUBLIC_SECTIONS: ReadonlySet<string> = new Set([
  'sign-in',
  'forgot-password',
  'reset-password',
  'register-school',
  'terms',
  'privacy',
]);

/** Whether a locale-prefixed path (`/en/sign-in`, `/en/register-school/verify`) is public. */
export function isPublicPath(pathname: string): boolean {
  const section = pathname.split('/')[2];
  return section !== undefined && PUBLIC_SECTIONS.has(section);
}

/** The sign-in page for `locale`, coming back to `pathname` + `search` afterwards. */
export function signInRedirect(pathname: string, search: string, locale: string): string {
  return `/${locale}/sign-in?next=${encodeURIComponent(pathname + search)}`;
}

/** The supported locale that starts `pathname`, if any. */
export function localeOf(pathname: string): string | undefined {
  const first = pathname.split('/')[1] ?? '';
  return (routing.locales as readonly string[]).includes(first) ? first : undefined;
}

/** Splits a location (`/en/students?q=1`) into its path and its query (with the `?`, or ''). */
export function splitLocation(location: string): { pathname: string; search: string } {
  const queryStart = location.indexOf('?');
  return queryStart === -1
    ? { pathname: location, search: '' }
    : { pathname: location.slice(0, queryStart), search: location.slice(queryStart) };
}

/** `signInRedirect` for a whole location, in its own locale (else the default one). */
export function signInRedirectFor(location: string): string {
  const { pathname, search } = splitLocation(location);
  return signInRedirect(pathname, search, localeOf(pathname) ?? routing.defaultLocale);
}

/** Request header `proxy.ts` sets for server components: the path and query that was asked for. */
export const PATHNAME_HEADER = 'x-pathname';

/**
 * Where a signed-in visitor of an `(auth)` page goes, from that page's location (path plus query),
 * or `null` to stay. The reset page stays (an emailed link must work, and the reset revokes every
 * session anyway); sign-in honours a safe `?next=`; the rest go to the dashboard.
 */
export function signedInAuthRedirect(location: string): string | null {
  const { pathname, search } = splitLocation(location);
  const locale = localeOf(pathname) ?? routing.defaultLocale;
  const dashboard = `/${locale}/dashboard`;
  const section = pathname.split('/')[2];
  if (section === 'reset-password') return null;
  if (section === 'sign-in') {
    const query = new URLSearchParams(search);
    // Proving yourself again before a sensitive change is meant for a signed-in visitor.
    if (query.get('reauth') === '1') return null;
    const next = query.get('next');
    return safeNextPath(next, routing.locales, dashboard);
  }
  return dashboard;
}
