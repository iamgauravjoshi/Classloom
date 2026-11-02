import { ALL_PERMISSIONS, type AuthSession } from '@classloom/contracts';
import { academicYearOf } from '@classloom/utils';
import { describe, expect, it } from 'vitest';

import { roleLabelOf, toShellSession } from './session';

const session: AuthSession = {
  user: {
    id: 'u1',
    name: 'Asha Rawat',
    email: 'asha@example.com',
    mobile: null,
    hasPassword: false,
  },
  school: { id: 't1', code: 'GISD', name: 'Global International School' },
  campus: { id: 'c1', name: 'Global International School, Dehradun' },
  roles: [{ key: 'OWNER', name: 'Owner' }],
  permissions: [...ALL_PERMISSIONS],
  twoFactorSetupRequired: false,
  remember: true,
  expiresAt: '2026-11-26T00:00:00.000Z',
};

const teacher: AuthSession = {
  ...session,
  roles: [
    { key: 'LIBRARIAN', name: 'Librarian' },
    { key: 'TEACHER', name: 'Teacher' },
  ],
  permissions: ['dashboard.view', 'students.view', 'library.view'],
};

describe('toShellSession', () => {
  it("maps the session's roles and permissions", () => {
    const shell = toShellSession(teacher);
    expect(shell.roles).toEqual([
      { key: 'LIBRARIAN', name: 'Librarian' },
      { key: 'TEACHER', name: 'Teacher' },
    ]);
    expect(shell.permissions).toEqual(['dashboard.view', 'students.view', 'library.view']);
    expect(shell.isOwner).toBe(false);
    expect(shell.portal).toBe('staff');
  });

  it('marks an owner and passes every permission through', () => {
    const shell = toShellSession(session);
    expect(shell.isOwner).toBe(true);
    expect(shell.permissions).toEqual([...ALL_PERMISSIONS]);
  });

  it('gives a member with no roles no permissions', () => {
    const shell = toShellSession({ ...session, roles: [], permissions: [] });
    expect(shell.roles).toEqual([]);
    expect(shell.permissions).toEqual([]);
    expect(shell.isOwner).toBe(false);
  });

  it("shows the user's name and the session's campus", () => {
    const shell = toShellSession(session);
    expect(shell.user).toEqual({ name: 'Asha Rawat' });
    expect(shell.campus).toEqual({ id: 'c1', name: 'Global International School, Dehradun' });
  });

  it('uses the current academic year', () => {
    expect(toShellSession(session).academicYear).toBe(academicYearOf(new Date()));
  });
});

describe('roleLabelOf', () => {
  it('labels an owner "Owner" even when another role sorts first', () => {
    const shell = toShellSession({
      ...session,
      roles: [
        { key: 'ACCOUNTANT', name: 'Accountant' },
        { key: 'OWNER', name: 'Owner' },
      ],
    });
    expect(roleLabelOf(shell)).toEqual({ kind: 'owner' });
  });

  it("uses the first role's name otherwise", () => {
    expect(roleLabelOf(toShellSession(teacher))).toEqual({ kind: 'named', name: 'Librarian' });
  });

  it('says so when there is no role', () => {
    expect(roleLabelOf({ roles: [], isOwner: false })).toEqual({ kind: 'none' });
  });
});
