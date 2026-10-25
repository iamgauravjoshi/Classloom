import {
  type Icon,
  IconBook,
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
  /** Permission key required to see the item; items without one are always visible. */
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
    items: [{ key: 'dashboard', href: '/dashboard', icon: IconLayoutDashboard }],
  },
  {
    key: 'people',
    items: [
      { key: 'students', href: '/students', icon: IconSchool, permission: 'students.read' },
      { key: 'admissions', href: '/admissions', icon: IconUserPlus, permission: 'admissions.read' },
      { key: 'parents', href: '/parents', icon: IconUsersGroup, permission: 'parents.read' },
      { key: 'staff', href: '/staff', icon: IconUserStar, permission: 'staff.read' },
    ],
  },
  {
    key: 'academic',
    items: [
      { key: 'classes', href: '/classes', icon: IconUsers, permission: 'classes.read' },
      { key: 'subjects', href: '/subjects', icon: IconBook, permission: 'subjects.read' },
      {
        key: 'timetable',
        href: '/timetable',
        icon: IconCalendarTime,
        permission: 'timetable.read',
      },
    ],
  },
  {
    key: 'finance',
    items: [{ key: 'fees', href: '/fees', icon: IconCash, permission: 'fees.read' }],
  },
  {
    key: 'settings',
    items: [
      {
        key: 'schoolProfile',
        href: '/school-profile',
        icon: IconSettings,
        permission: 'settings.school',
      },
      { key: 'usersRoles', href: '/users-roles', icon: IconUserShield, permission: 'iam.users' },
    ],
  },
];

/** Single-segment paths of every placeholder module page (all nav items except the dashboard). */
export const comingSoonSections: string[] = navConfig
  .flatMap((group) => group.items)
  .map((item) => item.href.slice(1))
  .filter((section) => section !== 'dashboard');
