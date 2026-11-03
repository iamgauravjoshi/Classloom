import { type Invitation, type Member, OWNER_ROLE_KEY, type Role } from '@classloom/contracts';

export interface RoleRef {
  id: string;
  key: string | null;
  name: string;
}

export type RowStatus = Member['status'] | 'INVITED';

export interface MemberRow {
  kind: 'member';
  key: string;
  name: string;
  email: string;
  roles: RoleRef[];
  status: Member['status'];
  membershipId: string;
  userId: string;
  twoFactorEnabled: boolean;
  lastSignInAt: string | null;
}

export interface InviteRow {
  kind: 'invite';
  key: string;
  name: string;
  email: string;
  roles: RoleRef[];
  status: 'INVITED';
  invitationId: string;
  expiresAt: string;
}

export type Row = MemberRow | InviteRow;

/** The people list: members, and every open invitation as an `INVITED` row, by name. */
export function mergeMembersAndInvites(
  members: readonly Member[],
  invitations: readonly Invitation[],
): Row[] {
  const rows: Row[] = [
    ...members.map((member): MemberRow => ({
      kind: 'member',
      key: `member:${member.membershipId}`,
      name: member.name,
      email: member.email,
      roles: member.roles,
      status: member.status,
      membershipId: member.membershipId,
      userId: member.userId,
      twoFactorEnabled: member.twoFactorEnabled,
      lastSignInAt: member.lastSignInAt,
    })),
    ...invitations.map((invitation): InviteRow => ({
      kind: 'invite',
      key: `invite:${invitation.id}`,
      name: invitation.name,
      email: invitation.email,
      roles: invitation.roles.map((role) => ({ id: role.id, key: null, name: role.name })),
      status: 'INVITED',
      invitationId: invitation.id,
      expiresAt: invitation.expiresAt,
    })),
  ];
  const collator = new Intl.Collator('en', { sensitivity: 'base' });
  return rows.sort(
    (a, b) => collator.compare(a.name, b.name) || collator.compare(a.email, b.email),
  );
}

/** The filters the Members API applies on the server, applied to the open invitations. */
export function filterInvitations(
  invitations: readonly Invitation[],
  filters: { search?: string; roleId?: string },
): Invitation[] {
  const needle = filters.search?.trim().toLowerCase();
  return invitations.filter(
    (invitation) =>
      (!needle ||
        invitation.name.toLowerCase().includes(needle) ||
        invitation.email.toLowerCase().includes(needle)) &&
      (!filters.roleId || invitation.roles.some((role) => role.id === filters.roleId)),
  );
}

/**
 * The roles the viewer may give (no escalation, as the API checks it): Owner only to an owner,
 * and any other role only when the viewer holds all its permissions. An owner holds everything,
 * so the API's list of Owner's permissions (empty or full) does not matter.
 */
export function assignableRoles(
  roles: readonly Role[],
  myPermissions: readonly string[],
  isOwner: boolean,
): Role[] {
  if (isOwner) return [...roles];
  const held = new Set(myPermissions);
  return roles.filter(
    (role) => role.key !== OWNER_ROLE_KEY && role.permissions.every((p) => held.has(p)),
  );
}

/** Only an owner may change, deactivate or reset an owner. */
export function canActOnMember(member: Pick<Member, 'roles'>, isOwner: boolean): boolean {
  return isOwner || !member.roles.some((role) => role.key === OWNER_ROLE_KEY);
}

export type RowAction = 'roles' | 'deactivate' | 'reactivate' | 'reset' | 'resend' | 'revoke';

/** What the viewer may do with a row; empty when there is nothing (the menu is then not drawn). */
export function actionsFor(
  row: Row,
  viewer: { canManage: boolean; isOwner: boolean; userId: string },
): RowAction[] {
  if (!viewer.canManage) return [];
  if (row.kind === 'invite') return ['resend', 'revoke'];
  if (!canActOnMember(row, viewer.isOwner)) return [];
  const self = row.userId === viewer.userId;
  const actions: RowAction[] = ['roles'];
  // The API refuses both on your own row; they are not offered.
  if (!self) {
    if (row.status === 'ACTIVE') actions.push('deactivate');
    if (row.status === 'DEACTIVATED') actions.push('reactivate');
    if (row.twoFactorEnabled) actions.push('reset');
  }
  return actions;
}

/**
 * The roles the Change roles dialog lists: what the viewer may give, plus what the person holds
 * that the viewer cannot change. Empty means there is nothing to choose (Save stays off).
 */
export function offeredRoles(
  roles: readonly Role[],
  heldIds: ReadonlySet<string>,
  assignableIds: ReadonlySet<string>,
): Role[] {
  return roles.filter((role) => assignableIds.has(role.id) || heldIds.has(role.id));
}
