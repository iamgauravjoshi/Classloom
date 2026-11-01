import type { CookieOptions, Request, Response } from 'express';

import type { Env } from '../../core/config/env.schema';
import { randomToken } from './crypto';

const ONE_YEAR_MS = 365 * 86_400_000;
/** Exactly what `randomToken` mints: 32 bytes as unpadded base64url. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

type CookieEnv = Pick<Env, 'COOKIE_SECURE'>;

/** Same `__Host-` rule as the session cookie. */
export const deviceCookieName = (env: CookieEnv): string =>
  env.COOKIE_SECURE ? '__Host-cl_device' : 'cl_device';

/** Never a `domain` (host-only). Express takes `maxAge` in milliseconds: one year. */
export function deviceCookieOptions(env: CookieEnv): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR_MS,
    ...(env.COOKIE_SECURE ? { secure: true } : {}),
  };
}

/**
 * Reads the one cookie from the raw header; no cookie parser is installed. Anything that is not
 * exactly 43 base64url characters counts as absent, so a tampered value is replaced by a fresh one.
 */
export function readDeviceToken(req: Pick<Request, 'headers'>, env: CookieEnv): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const name = deviceCookieName(env);
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return TOKEN_SHAPE.test(value) ? value : undefined;
  }
  return undefined;
}

/** The browser's device token: the existing one or a fresh one (not yet sent as a cookie). */
export const deviceTokenOf = (req: Pick<Request, 'headers'>, env: CookieEnv): string =>
  readDeviceToken(req, env) ?? randomToken();

/** (Re-)sets the device cookie, restarting its year. */
export function setDeviceCookie(
  res: Pick<Response, 'cookie'>,
  env: CookieEnv,
  token: string,
): void {
  res.cookie(deviceCookieName(env), token, deviceCookieOptions(env));
}

/** The browser's device token: the existing one or a fresh one. The cookie is always re-set so its year restarts. */
export function ensureDeviceToken(
  req: Pick<Request, 'headers'>,
  res: Pick<Response, 'cookie'>,
  env: CookieEnv,
): string {
  const token = deviceTokenOf(req, env);
  setDeviceCookie(res, env, token);
  return token;
}
