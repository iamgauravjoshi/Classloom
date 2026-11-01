import type { CookieOptions, Request, Response } from 'express';

import type { Env } from '../../core/config/env.schema';

const THIRTY_DAYS_MS = 30 * 86_400_000;

type CookieEnv = Pick<Env, 'COOKIE_SECURE'>;

/** `__Host-` needs Secure, which WebKit refuses on http://localhost, so local runs drop both. */
export const sessionCookieName = (env: CookieEnv): string =>
  env.COOKIE_SECURE ? '__Host-cl_session' : 'cl_session';

/** Never a `domain` (host-only). Not remembered means no `maxAge`: it ends with the browser. */
export function sessionCookieOptions(env: CookieEnv, remember: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    ...(env.COOKIE_SECURE ? { secure: true } : {}),
    ...(remember ? { maxAge: THIRTY_DAYS_MS } : {}),
  };
}

/** Reads the one cookie from the raw header; no cookie parser is installed. */
export function readSessionToken(
  req: Pick<Request, 'headers'>,
  env: CookieEnv,
): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const name = sessionCookieName(env);
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value === '' ? undefined : value;
  }
  return undefined;
}

export function setSessionCookie(
  res: Response,
  env: CookieEnv,
  token: string,
  remember: boolean,
): void {
  res.cookie(sessionCookieName(env), token, sessionCookieOptions(env, remember));
}

export function clearSessionCookie(res: Response, env: CookieEnv): void {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions(env, false);
  res.clearCookie(sessionCookieName(env), options);
}
