import {
  type Icon,
  IconBook,
  IconBuildingCommunity,
  IconCalendarEvent,
  IconCalendarTime,
  IconCash,
  IconLayoutDashboard,
  IconSchool,
  IconSettings,
  IconUserPlus,
  IconUsers,
  IconUsersGroup,
  IconUserShield,
  IconUserStar,
} from '@tabler/icons-react';

/** A sidebar entry. Its label is the i18n message `nav.<key>`. */
export interface NavItem {
  key: string;
  href: string;
  icon: Icon;
  /** Catalogue permission (`module.action`) required to see the item; none means always visible. */
  permission?: string;
  children?: NavItem[];
}

/** A labelled sidebar section. Its label is the i18n message `navGroups.<key>`. */
export interface NavGroup {
  key: string;
  items: NavItem[];
}

export const navConfig: NavGroup[] = [
  {
    key: 'main',
    items: [
      {
        key: 'dashboard',
        href: '/dashboard',
        icon: IconLayoutDashboard,
        permission: 'dashboard.view',
      },
    ],
  },
  {
    key: 'people',
    items: [
      { key: 'students', href: '/students', icon: IconSchool, permission: 'students.view' },
      { key: 'admissions', href: '/admissions', icon: IconUserPlus, permission: 'admissions.view' },
      { key: 'parents', href: '/parents', icon: IconUsersGroup, permission: 'parents.view' },
      { key: 'staff', href: '/staff', icon: IconUserStar, permission: 'staff.view' },
    ],
  },
  {
    key: 'academic',
    items: [
      { key: 'classes', href: '/classes', icon: IconUsers, permission: 'classes.view' },
      { key: 'subjects', href: '/subjects', icon: IconBook, permission: 'subjects.view' },
      {
        key: 'timetable',
        href: '/timetable',
        icon: IconCalendarTime,
        permission: 'timetable.view',
      },
    ],
  },
  {
    key: 'finance',
    items: [{ key: 'fees', href: '/fees', icon: IconCash, permission: 'fees.view' }],
  },
  {
    key: 'settings',
    items: [
      {
        key: 'schoolProfile',
        href: '/settings/school-profile',
        icon: IconSettings,
        permission: 'settings.view',
      },
      {
        key: 'academicYears',
        href: '/settings/academic-years',
        icon: IconCalendarEvent,
        permission: 'settings.view',
      },
      {
        key: 'campuses',
        href: '/settings/campuses',
        icon: IconBuildingCommunity,
        permission: 'settings.view',
      },
      { key: 'usersRoles', href: '/users-roles', icon: IconUserShield, permission: 'iam.view' },
    ],
  },
];

/** Single-segment pages that are built, with routes of their own. */
const BUILT_SECTIONS: ReadonlySet<string> = new Set(['dashboard', 'classes', 'subjects']);

/**
 * Single-segment paths of every placeholder module page: all nav items except the built ones and
 * the pages under a folder (`settings/...`), which have routes of their own.
 */
export const comingSoonSections: string[] = navConfig
  .flatMap((group) => group.items)
  .map((item) => item.href.slice(1))
  .filter((section) => !BUILT_SECTIONS.has(section) && !section.includes('/'));
