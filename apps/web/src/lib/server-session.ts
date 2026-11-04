import type { AuthSession } from '@classloom/contracts';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { routing } from '@/i18n/routing';

import { PATHNAME_HEADER, signInRedirectFor } from './auth-redirect';

/**
 * Asks the API to validate without sliding the session. A `Set-Cookie` from this server-to-server
 * call would never reach the browser, so the browser's own `GET /api/auth/session` (the app shell)
 * does the sliding. Paired with `SESSION_TOUCH_HEADER` in the API's `session.middleware.ts`.
 */
const NO_TOUCH = { 'x-session-touch': 'skip' };

const apiInternalUrl = () => process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/**
 * The signed-in session, validated by the API (server only). Calls the API directly, forwarding
 * the browser's cookies; never cached across requests. Deduplicated within one render, so the
 * layout and the page share one call. `null` when signed out or the session has ended.
 */
export const getServerSession = cache(async (): Promise<AuthSession | null> => {
  const cookie = (await headers()).get('cookie');
  if (!cookie) return null;
  const res = await fetch(`${apiInternalUrl()}/auth/session`, {
    headers: { cookie, accept: 'application/json', ...NO_TOUCH },
    cache: 'no-store',
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GET /auth/session failed with ${res.status}`);
  return (await res.json()) as AuthSession;
});

/** The session, or a redirect to sign-in that comes back to the requested page. */
export async function requireServerSession(): Promise<AuthSession> {
  const session = await getServerSession();
  if (session) return session;
  const requested = (await headers()).get(PATHNAME_HEADER) ?? `/${routing.defaultLocale}/dashboard`;
  redirect(signInRedirectFor(requested));
}

/**
 * A read from the API as the signed-in person (server only), for a page that needs data before it
 * renders (the dashboard's wizard redirect). Never cached. `null` when signed out or on any refusal
 * or failure, so the page can carry on without it.
 */
export async function serverApiGet<T>(path: string): Promise<T | null> {
  const cookie = (await headers()).get('cookie');
  if (!cookie) return null;
  try {
    const res = await fetch(`${apiInternalUrl()}${path}`, {
      headers: { cookie, accept: 'application/json', ...NO_TOUCH },
      cache: 'no-store',
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}
