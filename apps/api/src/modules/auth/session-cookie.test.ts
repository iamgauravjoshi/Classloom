import type { Request, Response } from 'express';

import type { Env } from '../../core/config/env.schema';
import {
  clearSessionCookie,
  readSessionToken,
  sessionCookieName,
  sessionCookieOptions,
  setSessionCookie,
} from './session-cookie';

const secure = { COOKIE_SECURE: true } as Env;
const plain = { COOKIE_SECURE: false } as Env;

describe('session cookie', () => {
  it('uses the __Host- prefix and Secure when COOKIE_SECURE is on', () => {
    expect(sessionCookieName(secure)).toBe('__Host-cl_session');
    expect(sessionCookieOptions(secure, true)).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('drops the prefix and Secure otherwise', () => {
    expect(sessionCookieName(plain)).toBe('cl_session');
    expect(sessionCookieOptions(plain, true).secure).toBeUndefined();
  });

  it('is persistent for 30 days only when remembered', () => {
    expect(sessionCookieOptions(plain, true).maxAge).toBe(30 * 86_400_000);
    expect(sessionCookieOptions(plain, false).maxAge).toBeUndefined();
  });

  it('never sets a domain', () => {
    expect(sessionCookieOptions(secure, true)).not.toHaveProperty('domain');
    expect(sessionCookieOptions(plain, false)).not.toHaveProperty('domain');
  });

  it('finds the cookie among others', () => {
    const req = { headers: { cookie: 'a=1; cl_session=tok-en_1; b=2' } } as Request;
    expect(readSessionToken(req, plain)).toBe('tok-en_1');
    expect(readSessionToken({ headers: {} } as Request, plain)).toBeUndefined();
    expect(readSessionToken({ headers: { cookie: 'a=1' } } as Request, plain)).toBeUndefined();
    expect(
      readSessionToken({ headers: { cookie: 'xcl_session=no' } } as Request, plain),
    ).toBeUndefined();
  });

  it('sets and clears through the response', () => {
    const cookie = vi.fn();
    const clearCookie = vi.fn();
    const res = { cookie, clearCookie } as unknown as Response;
    setSessionCookie(res, plain, 'tok', false);
    expect(cookie).toHaveBeenCalledWith('cl_session', 'tok', sessionCookieOptions(plain, false));
    clearSessionCookie(res, plain);
    const [name, options] = clearCookie.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe('cl_session');
    expect(options).toMatchObject({ path: '/', httpOnly: true, sameSite: 'lax' });
    expect(options).not.toHaveProperty('maxAge');
  });
});
