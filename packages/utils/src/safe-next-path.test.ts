import { describe, expect, it } from 'vitest';

import { safeNextPath } from './safe-next-path';

const locales = ['en'] as const;
const fallback = '/en/dashboard';

describe('safeNextPath', () => {
  it('keeps a same-site path under a supported locale, with its query', () => {
    expect(safeNextPath('/en/students?x=1', locales, fallback)).toBe('/en/students?x=1');
    expect(safeNextPath('/en/dashboard', locales, fallback)).toBe('/en/dashboard');
    expect(safeNextPath('/en', locales, fallback)).toBe('/en');
  });

  it.each([
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash host', '/\\evil.example'],
    ['a backslash after the locale', '/en/\\evil.example'],
    ['an absolute URL', 'https://evil.example'],
    ['an unsupported locale', '/fr/dashboard'],
    ['a locale-like prefix', '/english/dashboard'],
    ['a path without a leading slash', 'en/dashboard'],
    ['an empty string', ''],
    ['a control character', '/en/a\nb'],
  ])('falls back for %s', (_label, input) => {
    expect(safeNextPath(input, locales, fallback)).toBe(fallback);
  });

  it('falls back for null and undefined', () => {
    expect(safeNextPath(null, locales, fallback)).toBe(fallback);
    expect(safeNextPath(undefined, locales, fallback)).toBe(fallback);
  });

  it('falls back for the sign-in page itself so signing in cannot loop', () => {
    expect(safeNextPath('/en/sign-in', locales, fallback)).toBe(fallback);
    expect(safeNextPath('/en/sign-in?next=x', locales, fallback)).toBe(fallback);
    expect(safeNextPath('/en/sign-in/', locales, fallback)).toBe(fallback);
    expect(safeNextPath('/en/sign-in#top', locales, fallback)).toBe(fallback);
  });

  it('does not treat a longer segment starting with sign-in as the sign-in page', () => {
    expect(safeNextPath('/en/sign-input', locales, fallback)).toBe('/en/sign-input');
  });
});
