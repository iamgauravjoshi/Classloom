import { describe, expect, it } from 'vitest';

import { navConfig } from '@/config/nav';

import { canOpenSection, permissionForSection } from './page-access';

describe('permissionForSection', () => {
  it('reads each page’s permission from the navigation config', () => {
    for (const item of navConfig.flatMap((group) => group.items)) {
      expect(permissionForSection(item.href.slice(1)), item.href).toBe(item.permission);
    }
  });

  it('requires dashboard.view for the dashboard and students.view for students', () => {
    expect(permissionForSection('dashboard')).toBe('dashboard.view');
    expect(permissionForSection('students')).toBe('students.view');
  });

  it('knows nothing of a page that is not in the navigation', () => {
    expect(permissionForSection('nope')).toBeUndefined();
  });
});

describe('canOpenSection', () => {
  it('opens a page whose permission the member holds', () => {
    expect(canOpenSection('students', ['students.view'])).toBe(true);
  });

  it('refuses a page whose permission is missing', () => {
    expect(canOpenSection('students', ['dashboard.view'])).toBe(false);
    expect(canOpenSection('dashboard', [])).toBe(false);
  });

  it('refuses a page that is not in the navigation', () => {
    expect(canOpenSection('nope', ['students.view'])).toBe(false);
  });
});
