import { routing } from '@/i18n/routing';

import { localeOf, splitLocation } from './auth-redirect';

/** The section (first segment after the locale) of the required two-step setup page. */
export const SETUP_SECTION = 'setup-two-factor';

/** Whether a locale-prefixed location (path with or without a query) is the setup page. */
export function isSetupPath(location: string): boolean {
  const { pathname } = splitLocation(location);
  const [, , section, ...rest] = pathname.split('/');
  return section === SETUP_SECTION && rest.every((part) => part === '');
}

/**
 * Where the `(app)` layout sends a session: to the setup page, coming back to the page asked for,
 * when the session must set up two-step, else `null`. Never from the setup page itself.
 */
export function twoFactorSetupRedirect(required: boolean, location: string): string | null {
  if (!required || isSetupPath(location)) return null;
  const { pathname } = splitLocation(location);
  const locale = localeOf(pathname) ?? routing.defaultLocale;
  return `/${locale}/${SETUP_SECTION}?next=${encodeURIComponent(location)}`;
}
