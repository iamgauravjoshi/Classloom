import { type AuthSession, OWNER_ROLE_KEY } from '@classloom/contracts';
import { academicYearOf } from '@classloom/utils';

/**
 * Which portal the shell renders. Every school member is staff; parent and student portals come
 * with their own parts and get the phone tab bar.
 */
export type Portal = 'staff' | 'parent' | 'student';

/** Serializable slice of the session that the server layout passes to the app shell. */
export interface ShellSession {
  user: { name: string; avatarUrl?: string };
  portal: Portal;
  /** The member's roles, as the API orders them (by name). */
  roles: { key: string | null; name: string }[];
  /** Holds the Owner role: labelled "Owner" whatever else they hold. */
  isOwner: boolean;
  /** Effective permissions (catalogue keys); the shell hides what is not here. */
  permissions: string[];
  campus: { id: string; name: string };
  academicYear: string;
}

/** Maps the API session to the shell's: roles and permissions come straight from the API. */
export function toShellSession(session: AuthSession): ShellSession {
  return {
    user: { name: session.user.name },
    portal: 'staff',
    roles: session.roles.map((role) => ({ key: role.key, name: role.name })),
    isOwner: session.roles.some((role) => role.key === OWNER_ROLE_KEY),
    permissions: [...session.permissions],
    campus: { id: session.campus.id, name: session.campus.name },
    academicYear: academicYearOf(new Date()),
  };
}

export type RoleLabel = { kind: 'owner' } | { kind: 'named'; name: string } | { kind: 'none' };

/**
 * The role label the shell shows: "Owner" for an owner, otherwise the first role's name, or
 * "No role" when the member holds none. Owner and none are i18n messages (`roles.*`).
 */
export function roleLabelOf(session: Pick<ShellSession, 'roles' | 'isOwner'>): RoleLabel {
  if (session.isOwner) return { kind: 'owner' };
  const first = session.roles[0];
  return first ? { kind: 'named', name: first.name } : { kind: 'none' };
}
