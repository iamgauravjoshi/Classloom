import type { Request, Response } from 'express';

import type { Env } from '../../core/config/env.schema';
import {
  deviceCookieName,
  deviceCookieOptions,
  ensureDeviceToken,
  readDeviceToken,
} from './device-cookie';

const secure = { COOKIE_SECURE: true } as Env;
const plain = { COOKIE_SECURE: false } as Env;

const reqWith = (cookie?: string) => ({ headers: cookie ? { cookie } : {} }) as unknown as Request;
const fakeRes = () => {
  const calls: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const res = {
    cookie: (name: string, value: string, options: Record<string, unknown>) =>
      calls.push({ name, value, options }),
  } as unknown as Response;
  return { res, calls };
};

describe('device cookie', () => {
  it('is named per COOKIE_SECURE', () => {
    expect(deviceCookieName(secure)).toBe('__Host-cl_device');
    expect(deviceCookieName(plain)).toBe('cl_device');
  });

  it('is HttpOnly, Lax, Path=/, one year, host-only', () => {
    const options = deviceCookieOptions(secure);
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 31_536_000_000,
      secure: true,
    });
    expect(options).not.toHaveProperty('domain');
    expect(deviceCookieOptions(plain).secure).toBeUndefined();
  });

  it('reads the token from the raw header', () => {
    expect(readDeviceToken(reqWith('a=1; cl_device=tok123; b=2'), plain)).toBe('tok123');
    expect(readDeviceToken(reqWith('__Host-cl_device=tok'), plain)).toBeUndefined();
    expect(readDeviceToken(reqWith('cl_device='), plain)).toBeUndefined();
    expect(readDeviceToken(reqWith(), plain)).toBeUndefined();
  });

  it('reuses an existing token and re-sets the cookie', () => {
    const { res, calls } = fakeRes();
    expect(ensureDeviceToken(reqWith('cl_device=keepme'), res, plain)).toBe('keepme');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: 'cl_device', value: 'keepme' });
  });

  it('mints a 32-byte base64url token when there is none', () => {
    const { res, calls } = fakeRes();
    const token = ensureDeviceToken(reqWith(), res, secure);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(calls[0]).toMatchObject({ name: '__Host-cl_device', value: token });
  });
});
