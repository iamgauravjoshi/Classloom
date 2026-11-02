import type { Invitation, Member, Role } from '@classloom/contracts';
import { describe, expect, it } from 'vitest';

import {
  actionsFor,
  assignableRoles,
  canActOnMember,
  filterInvitations,
  mergeMembersAndInvites,
  offeredRoles,
  type Row,
} from './members-model';

const member = (over: Partial<Member> = {}): Member => ({
  membershipId: 'm1',
  userId: 'u1',
  name: 'Anita Sharma',
  email: 'anita@example.com',
  roles: [{ id: 'r-teacher', key: 'TEACHER', name: 'Teacher' }],
  status: 'ACTIVE',
  twoFactorEnabled: false,
  lastSignInAt: null,
  ...over,
});

const invitation = (over: Partial<Invitation> = {}): Invitation => ({
  id: 'i1',
  email: 'ravi@example.com',
  name: 'Ravi Kumar',
  roles: [{ id: 'r-teacher', name: 'Teacher' }],
  expiresAt: '2026-11-09T00:00:00.000Z',
  invitedBy: 'Asha Rawat',
  createdAt: '2026-11-02T00:00:00.000Z',
  ...over,
});

const role = (over: Partial<Role> = {}): Role => ({
  id: 'r1',
  key: null,
  name: 'Custom',
  description: '',
  requiresTwoFactor: false,
  permissions: [],
  memberCount: 0,
  ...over,
});

function onlyRow(rows: Row[]): Row {
  const [row] = rows;
  if (!row) throw new Error('no row');
  return row;
}

describe('mergeMembersAndInvites', () => {
  it('turns invitations into INVITED rows and sorts everything by name', () => {
    const rows = mergeMembersAndInvites(
      [member({ membershipId: 'm2', name: 'Zoya Khan' }), member({ name: 'anita Sharma' })],
      [invitation({ name: 'Mohan Das' })],
    );
    expect(rows.map((row) => [row.kind, row.status, row.name])).toEqual([
      ['member', 'ACTIVE', 'anita Sharma'],
      ['invite', 'INVITED', 'Mohan Das'],
      ['member', 'ACTIVE', 'Zoya Khan'],
    ]);
  });

  it('keeps the invitation id and expiry on an invited row', () => {
    const row = onlyRow(mergeMembersAndInvites([], [invitation()]));
    expect(row).toMatchObject({
      kind: 'invite',
      key: 'invite:i1',
      invitationId: 'i1',
      expiresAt: '2026-11-09T00:00:00.000Z',
      roles: [{ id: 'r-teacher', key: null, name: 'Teacher' }],
    });
  });

  it('breaks a tie on the name by the email, so the order is stable', () => {
    const rows = mergeMembersAndInvites(
      [member({ membershipId: 'a', email: 'b@example.com' })],
      [invitation({ name: 'Anita Sharma', email: 'a@example.com' })],
    );
    expect(rows.map((row) => row.email)).toEqual(['a@example.com', 'b@example.com']);
  });

  it('is empty when both lists are', () => {
    expect(mergeMembersAndInvites([], [])).toEqual([]);
  });
});

describe('filterInvitations', () => {
  const list = [
    invitation({ id: 'i1', name: 'Ravi Kumar', email: 'ravi@example.com' }),
    invitation({
      id: 'i2',
      name: 'Meena Joshi',
      email: 'meena@example.com',
      roles: [{ id: 'r-lib', name: 'Librarian' }],
    }),
  ];

  it('keeps all with no filter', () => {
    expect(filterInvitations(list, {})).toHaveLength(2);
  });

  it('searches the name and the email, ignoring case and spaces at the ends', () => {
    expect(filterInvitations(list, { search: ' MEENA ' }).map((i) => i.id)).toEqual(['i2']);
    expect(filterInvitations(list, { search: 'ravi@' }).map((i) => i.id)).toEqual(['i1']);
  });

  it('filters by a role the invitation carries', () => {
    expect(filterInvitations(list, { roleId: 'r-lib' }).map((i) => i.id)).toEqual(['i2']);
  });
});

describe('assignableRoles', () => {
  const owner = role({ id: 'r-owner', key: 'OWNER', name: 'Owner', permissions: [] });
  const principal = role({
    id: 'r-pr',
    key: 'PRINCIPAL',
    permissions: ['students.view', 'iam.view'],
  });
  const admin = role({ id: 'r-ad', key: 'ADMIN', permissions: ['students.view', 'iam.manage'] });
  const teacher = role({ id: 'r-te', key: 'TEACHER', permissions: ['students.view'] });
  const empty = role({ id: 'r-em', name: 'Empty', permissions: [] });
  const all = [owner, principal, admin, teacher, empty];

  it('gives an owner every role, Owner included, whatever the list of their permissions', () => {
    expect(assignableRoles(all, [], true).map((r) => r.id)).toEqual(all.map((r) => r.id));
  });

  it('hides Owner from anyone else, even someone holding every permission', () => {
    const everything = ['students.view', 'iam.view', 'iam.manage'];
    const ids = assignableRoles(all, everything, false).map((r) => r.id);
    expect(ids).not.toContain('r-owner');
    expect(ids).toEqual(['r-pr', 'r-ad', 'r-te', 'r-em']);
  });

  it('hides a role with a permission the viewer lacks', () => {
    expect(assignableRoles(all, ['students.view', 'iam.view'], false).map((r) => r.id)).toEqual([
      'r-pr',
      'r-te',
      'r-em',
    ]);
  });

  it('treats Owner the same when the API lists it with every permission', () => {
    const full = role({ id: 'r-owner', key: 'OWNER', permissions: ['students.view'] });
    expect(assignableRoles([full], ['students.view'], false)).toEqual([]);
    expect(assignableRoles([full], [], true)).toEqual([full]);
  });
});

describe('canActOnMember', () => {
  const owner = member({ roles: [{ id: 'r-owner', key: 'OWNER', name: 'Owner' }] });

  it('lets an owner act on anyone, and others on anyone but an owner', () => {
    expect(canActOnMember(owner, true)).toBe(true);
    expect(canActOnMember(owner, false)).toBe(false);
    expect(canActOnMember(member(), false)).toBe(true);
  });
});

describe('actionsFor', () => {
  const viewer = { canManage: true, isOwner: false, userId: 'me' };
  const other = onlyRow(
    mergeMembersAndInvites([member({ userId: 'u9', twoFactorEnabled: true })], []),
  );
  const self = onlyRow(
    mergeMembersAndInvites([member({ userId: 'me', twoFactorEnabled: true })], []),
  );
  const invited = onlyRow(mergeMembersAndInvites([], [invitation()]));

  it('offers nothing without iam.manage', () => {
    for (const row of [other, self, invited]) {
      expect(actionsFor(row, { ...viewer, canManage: false })).toEqual([]);
    }
  });

  it('offers roles, deactivate and reset on another active member with two-step on', () => {
    expect(actionsFor(other, viewer)).toEqual(['roles', 'deactivate', 'reset']);
  });

  it('offers no reset when two-step is off, and reactivate on a deactivated member', () => {
    const off = onlyRow(
      mergeMembersAndInvites([member({ userId: 'u9', status: 'DEACTIVATED' })], []),
    );
    expect(actionsFor(off, viewer)).toEqual(['roles', 'reactivate']);
  });

  it('hides deactivate and reset on your own row', () => {
    expect(actionsFor(self, viewer)).toEqual(['roles']);
  });

  it('offers resend and revoke on an invitation', () => {
    expect(actionsFor(invited, viewer)).toEqual(['resend', 'revoke']);
  });

  it('leaves an owner to owners', () => {
    const owner = onlyRow(
      mergeMembersAndInvites(
        [member({ userId: 'u9', roles: [{ id: 'r', key: 'OWNER', name: 'Owner' }] })],
        [],
      ),
    );
    expect(actionsFor(owner, viewer)).toEqual([]);
    expect(actionsFor(owner, { ...viewer, isOwner: true })).toEqual(['roles', 'deactivate']);
  });
});

describe('offeredRoles', () => {
  const a = role({ id: 'a' });
  const b = role({ id: 'b' });
  const c = role({ id: 'c' });

  it('lists what the viewer may give and what the person holds', () => {
    expect(offeredRoles([a, b, c], new Set(['c']), new Set(['a'])).map((r) => r.id)).toEqual([
      'a',
      'c',
    ]);
  });

  it('is empty when the viewer can give none and the person holds none, or there are no roles', () => {
    expect(offeredRoles([a, b], new Set(), new Set())).toEqual([]);
    expect(offeredRoles([], new Set(['a']), new Set(['a']))).toEqual([]);
  });
});
