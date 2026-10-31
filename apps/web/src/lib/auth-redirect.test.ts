import { describe, expect, it } from 'vitest';

import {
  isPublicPath,
  signedInAuthRedirect,
  signInRedirect,
  signInRedirectFor,
} from './auth-redirect';

describe('isPublicPath', () => {
  it('treats app pages as protected', () => {
    expect(isPublicPath('/en/dashboard')).toBe(false);
    expect(isPublicPath('/en/students/123')).toBe(false);
    expect(isPublicPath('/en')).toBe(false);
    expect(isPublicPath('/en/account')).toBe(false);
  });

  it('treats the auth and public pages, and anything below them, as public', () => {
    for (const path of [
      '/en/sign-in',
      '/en/forgot-password',
      '/en/reset-password',
      '/en/register-school',
      '/en/register-school/verify',
      '/en/terms',
      '/en/privacy',
    ]) {
      expect(isPublicPath(path), path).toBe(true);
    }
  });

  it('matches whole segments only', () => {
    expect(isPublicPath('/en/sign-in-later')).toBe(false);
    expect(isPublicPath('/en/termsheet')).toBe(false);
  });
});

describe('signInRedirect', () => {
  it('sends to the locale sign-in page with the encoded path and query as next', () => {
    expect(signInRedirect('/en/students', '?q=1', 'en')).toBe(
      '/en/sign-in?next=%2Fen%2Fstudents%3Fq%3D1',
    );
  });

  it('works without a query', () => {
    expect(signInRedirect('/en/dashboard', '', 'en')).toBe('/en/sign-in?next=%2Fen%2Fdashboard');
  });
});

describe('signInRedirectFor', () => {
  it('splits a location into path and query and uses its locale', () => {
    expect(signInRedirectFor('/en/students?q=1')).toBe('/en/sign-in?next=%2Fen%2Fstudents%3Fq%3D1');
  });

  it('falls back to the default locale for an unknown first segment', () => {
    expect(signInRedirectFor('/xx/students')).toBe('/en/sign-in?next=%2Fxx%2Fstudents');
  });
});

describe('signedInAuthRedirect', () => {
  it('leaves the reset page alone: a reset link must work while signed in', () => {
    expect(signedInAuthRedirect('/en/reset-password')).toBeNull();
    expect(signedInAuthRedirect('/en/reset-password?token=abc')).toBeNull();
  });

  it('sends sign-in to a safe next, else the dashboard', () => {
    expect(signedInAuthRedirect('/en/sign-in?next=%2Fen%2Fstudents%3Fq%3D1')).toBe(
      '/en/students?q=1',
    );
    expect(signedInAuthRedirect('/en/sign-in')).toBe('/en/dashboard');
    expect(signedInAuthRedirect('/en/sign-in?next=%2F%2Fevil.example')).toBe('/en/dashboard');
    expect(signedInAuthRedirect('/en/sign-in?next=https%3A%2F%2Fevil.example')).toBe(
      '/en/dashboard',
    );
    expect(signedInAuthRedirect('/en/sign-in?next=%2Fen%2Fsign-in')).toBe('/en/dashboard');
  });

  it('sends forgot-password to the dashboard, ignoring next', () => {
    expect(signedInAuthRedirect('/en/forgot-password')).toBe('/en/dashboard');
    expect(signedInAuthRedirect('/en/forgot-password?next=%2Fen%2Fstudents')).toBe('/en/dashboard');
  });

  it('falls back to the default locale dashboard for an unknown location', () => {
    expect(signedInAuthRedirect('')).toBe('/en/dashboard');
  });
});
