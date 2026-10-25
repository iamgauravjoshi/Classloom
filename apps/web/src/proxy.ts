import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next internals, the service worker route, generated icons and files.
  matcher: ['/((?!api|_next|_vercel|serwist|icons|.*\\..*).*)'],
};
