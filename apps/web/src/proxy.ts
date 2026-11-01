import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';
import { isPublicPath, localeOf, PATHNAME_HEADER, signInRedirect } from './lib/auth-redirect';

const handleI18nRouting = createMiddleware(routing);

/** `cl_session` on plain HTTP (local, CI); `__Host-cl_session` when the API sets Secure cookies. */
const SESSION_COOKIES = ['cl_session', '__Host-cl_session'];

/**
 * A fast first check only: a locale page that is not public needs a session cookie, else it goes
 * to sign-in and comes back afterwards. The `(app)` layout asks the API whether the session is
 * still valid. Paths without a locale are left to next-intl, which adds one and redirects.
 */
export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const locale = localeOf(pathname);
  const signedIn = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (locale && !isPublicPath(pathname) && !signedIn) {
    return NextResponse.redirect(new URL(signInRedirect(pathname, search, locale), request.url));
  }

  // Tells server components which page was asked for (the layout's sign-in redirect needs it).
  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, pathname + search);
  return handleI18nRouting(new NextRequest(request.url, { headers }));
}

export const config = {
  // Everything except API routes, Next internals, the service worker route, generated icons and files.
  matcher: ['/((?!api|_next|_vercel|serwist|icons|.*\\..*).*)'],
};
