import { academicYearOf } from '@classloom/utils';

import { navConfig } from '@/config/nav';

export type Role = 'admin' | 'teacher' | 'parent' | 'student';

export interface Session {
  user: { name: string; avatarUrl?: string };
  role: Role;
  permissions: Set<string>;
  campus: { id: string; name: string };
  academicYear: string;
}

const ALL_NAV_PERMISSIONS = navConfig
  .flatMap((group) => group.items)
  .flatMap((item) => (item.permission ? [item.permission] : []));

/** Stand-in for the signed-in user until real authentication lands in Phase 1. */
export function getMockSession(): Session {
  return {
    user: { name: 'Anita Sharma' },
    role: 'admin',
    permissions: new Set(ALL_NAV_PERMISSIONS),
    campus: { id: 'campus-main', name: 'Global International School, Dehradun' },
    academicYear: academicYearOf(new Date()),
  };
}
