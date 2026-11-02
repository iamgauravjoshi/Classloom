import { ALL_PERMISSIONS } from '@classloom/contracts';
import { describe, expect, it } from 'vitest';

import { navConfig, type NavItem } from './nav';

const flatten = (items: NavItem[]): NavItem[] =>
  items.flatMap((item) => [item, ...flatten(item.children ?? [])]);

const navItems = flatten(navConfig.flatMap((group) => group.items));

describe('navConfig', () => {
  it('asks only for permissions in the catalogue', () => {
    const permissions = navItems.flatMap((item) => (item.permission ? [item.permission] : []));
    expect(permissions.length).toBeGreaterThan(0);
    for (const permission of permissions) expect(ALL_PERMISSIONS).toContain(permission);
  });

  it("guards each module page with its module's view permission", () => {
    expect(
      Object.fromEntries(navItems.map((item) => [item.href, item.permission ?? null])),
    ).toEqual({
      '/dashboard': 'dashboard.view',
      '/students': 'students.view',
      '/admissions': 'admissions.view',
      '/parents': 'parents.view',
      '/staff': 'staff.view',
      '/classes': 'classes.view',
      '/subjects': 'subjects.view',
      '/timetable': 'timetable.view',
      '/fees': 'fees.view',
      '/school-profile': 'settings.view',
      '/users-roles': 'iam.view',
    });
  });
});
