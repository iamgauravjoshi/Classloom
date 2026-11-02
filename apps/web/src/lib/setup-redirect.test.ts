import { describe, expect, it } from 'vitest';

import { isSetupPath, twoFactorSetupRedirect } from './setup-redirect';

describe('twoFactorSetupRedirect', () => {
  it('sends a session that must set up two-step to the setup page, coming back to the page asked for', () => {
    expect(twoFactorSetupRedirect(true, '/en/students?q=1')).toBe(
      '/en/setup-two-factor?next=%2Fen%2Fstudents%3Fq%3D1',
    );
  });

  it('uses the locale of the page asked for', () => {
    expect(twoFactorSetupRedirect(true, '/en/dashboard')).toBe(
      '/en/setup-two-factor?next=%2Fen%2Fdashboard',
    );
  });

  it('falls back to the default locale and the dashboard for an unknown location', () => {
    expect(twoFactorSetupRedirect(true, '/xx/students')).toBe(
      '/en/setup-two-factor?next=%2Fxx%2Fstudents',
    );
  });

  it('does not redirect a session that has nothing to set up', () => {
    expect(twoFactorSetupRedirect(false, '/en/dashboard')).toBeNull();
  });

  it('does not redirect when already on the setup page (no loop), with or without a query', () => {
    expect(twoFactorSetupRedirect(true, '/en/setup-two-factor')).toBeNull();
    expect(twoFactorSetupRedirect(true, '/en/setup-two-factor?next=%2Fen%2Fdashboard')).toBeNull();
  });

  it('matches the setup section only, not look-alikes', () => {
    expect(isSetupPath('/en/setup-two-factor')).toBe(true);
    expect(isSetupPath('/en/setup-two-factor/')).toBe(true);
    expect(isSetupPath('/en/setup-two-factor-later')).toBe(false);
    expect(isSetupPath('/en/account/setup-two-factor')).toBe(false);
  });
});
