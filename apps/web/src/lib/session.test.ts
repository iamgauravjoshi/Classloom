import type { AuthSession } from '@classloom/contracts';
import { academicYearOf } from '@classloom/utils';
import { describe, expect, it } from 'vitest';

import { toShellSession } from './session';

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
  role: 'OWNER',
  remember: true,
  expiresAt: '2026-11-26T00:00:00.000Z',
};

describe('toShellSession', () => {
  it('maps an OWNER to the admin role with every nav permission', () => {
    const shell = toShellSession(session, ['students.read', 'fees.read']);
    expect(shell.role).toBe('admin');
    expect(shell.permissions).toEqual(['students.read', 'fees.read']);
  });

  it("shows the user's name and the session's campus", () => {
    const shell = toShellSession(session, []);
    expect(shell.user).toEqual({ name: 'Asha Rawat' });
    expect(shell.campus).toEqual({ id: 'c1', name: 'Global International School, Dehradun' });
  });

  it('uses the current academic year', () => {
    expect(toShellSession(session, []).academicYear).toBe(academicYearOf(new Date()));
  });
});
