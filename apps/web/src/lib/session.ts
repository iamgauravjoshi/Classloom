import type { AuthSession } from '@classloom/contracts';
import { academicYearOf } from '@classloom/utils';

export type Role = 'admin' | 'teacher' | 'parent' | 'student';

/** Serializable slice of the session that the server layout passes to the app shell. */
export interface ShellSession {
  user: { name: string; avatarUrl?: string };
  role: Role;
  permissions: string[];
  campus: { id: string; name: string };
  academicYear: string;
}

/**
 * Maps the API session to the shell's. Until Part 3 adds real permissions, the school owner (the
 * only role so far) is an admin who sees every nav item, passed in as `navPermissions`.
 */
export function toShellSession(session: AuthSession, navPermissions: string[]): ShellSession {
  return {
    user: { name: session.user.name },
    // IAM: replaced in Task 3 (the shell maps the session's roles and permissions).
    role: 'admin',
    permissions: [...navPermissions],
    campus: { id: session.campus.id, name: session.campus.name },
    academicYear: academicYearOf(new Date()),
  };
}
