// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Returns `next` when it is a safe same-site path to send a person to after signing in, else
 * `fallback`. Safe means: one leading `/` (so never `//host`), no backslash (browsers read `\` as
 * `/`), no control characters, a supported locale as the first segment, and not the sign-in page
 * itself (which would loop).
 */
export function safeNextPath(
  next: string | null | undefined,
  locales: readonly string[],
  fallback: string,
): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return fallback;
  if (next.includes('\\') || CONTROL_CHARACTERS.test(next)) return fallback;

  const pathname = next.split(/[?#]/, 1)[0] ?? '';
  const [, locale, section] = pathname.split('/');
  if (locale === undefined || !locales.includes(locale)) return fallback;
  if (section === 'sign-in') return fallback;
  return next;
}
