import { ALL_PERMISSIONS, BUILT_IN_ROLE_DEFAULTS } from '@classloom/contracts';
import { describe, expect, it } from 'vitest';

import { filterNav } from '@/lib/nav-filter';

import { comingSoonSections, navConfig, type NavItem } from './nav';

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
      '/settings/school-profile': 'settings.view',
      '/settings/academic-years': 'settings.view',
      '/settings/campuses': 'settings.view',
      '/users-roles': 'iam.view',
    });
  });
});

describe('the Settings group', () => {
  const settingsOf = (permissions: readonly string[]) =>
    filterNav(navConfig, new Set(permissions)).find((group) => group.key === 'settings');

  it('is hidden from a Teacher, who has no settings.view', () => {
    const teacher = BUILT_IN_ROLE_DEFAULTS.TEACHER.permissions;
    if (teacher === 'ALL') throw new Error('A Teacher is not given every permission');
    expect(teacher).not.toContain('settings.view');
    expect(settingsOf(teacher)).toBeUndefined();
  });

  it('shows all three settings pages with settings.view alone', () => {
    expect(settingsOf(['settings.view'])?.items.map((item) => item.href)).toEqual([
      '/settings/school-profile',
      '/settings/academic-years',
      '/settings/campuses',
    ]);
  });
});

describe('comingSoonSections', () => {
  it('lists the single-segment module pages, not the dashboard or the settings pages', () => {
    expect(comingSoonSections).toEqual([
      'students',
      'admissions',
      'parents',
      'staff',
      'classes',
      'subjects',
      'timetable',
      'fees',
      'users-roles',
    ]);
  });
});
