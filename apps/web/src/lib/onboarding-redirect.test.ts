import { describe, expect, it } from 'vitest';

import { shouldOpenWizard } from './onboarding-redirect';

describe('shouldOpenWizard', () => {
  it('opens the wizard for a settings manager whose school never opened it', () => {
    expect(shouldOpenWizard({ canManage: true, startedAt: null })).toBe(true);
  });

  it('never opens it again once it was started', () => {
    expect(shouldOpenWizard({ canManage: true, startedAt: '2026-11-03T10:00:00.000Z' })).toBe(
      false,
    );
  });

  it('never opens it for someone who cannot manage settings', () => {
    expect(shouldOpenWizard({ canManage: false, startedAt: null })).toBe(false);
    expect(shouldOpenWizard({ canManage: false, startedAt: '2026-11-03T10:00:00.000Z' })).toBe(
      false,
    );
  });
});
