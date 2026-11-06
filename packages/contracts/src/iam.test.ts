import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSIONS,
  BUILT_IN_ROLE_DEFAULTS,
  BUILT_IN_ROLE_KEYS,
  canGrant,
  createInvitationRequestSchema,
  createRoleRequestSchema,
  effectivePermissions,
  PERMISSION_CATALOGUE,
  permissionSchema,
  ROLE_PRESETS,
  setMemberRolesRequestSchema,
  updateRoleRequestSchema,
  withImpliedView,
} from './iam';

describe('permission catalogue', () => {
  it('has the 18 modules and actions of the spec, in order', () => {
    expect(PERMISSION_CATALOGUE.map((m) => [m.module, [...m.actions]])).toEqual([
      ['dashboard', ['view']],
      ['students', ['view', 'create', 'edit', 'delete', 'export']],
      ['admissions', ['view', 'create', 'edit', 'delete', 'approve', 'export']],
      ['parents', ['view', 'create', 'edit', 'delete']],
      ['staff', ['view', 'create', 'edit', 'delete', 'export']],
      ['classes', ['view', 'manage']],
      ['subjects', ['view', 'manage']],
      ['timetable', ['view', 'manage']],
      ['attendance', ['view', 'create', 'edit', 'export']],
      ['exams', ['view', 'create', 'edit', 'approve', 'export']],
      ['fees', ['view', 'create', 'edit', 'approve', 'export']],
      ['library', ['view', 'manage']],
      ['transport', ['view', 'manage']],
      ['communication', ['view', 'create', 'approve']],
      ['reports', ['view', 'export']],
      ['settings', ['view', 'manage']],
      ['iam', ['view', 'manage']],
      ['audit', ['view']],
    ]);
  });

  it('lists unique, well-formed keys', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    for (const key of ALL_PERMISSIONS) {
      expect(key).toMatch(/^[a-z]+\.(view|create|edit|delete|export|approve|manage)$/);
    }
    expect(permissionSchema.safeParse('students.view').success).toBe(true);
    expect(permissionSchema.safeParse('students.read').success).toBe(false);
  });
});

describe('built-in roles', () => {
  it('references only catalogue keys', () => {
    for (const key of BUILT_IN_ROLE_KEYS) {
      const { permissions } = BUILT_IN_ROLE_DEFAULTS[key];
      if (permissions === 'ALL') continue;
      for (const p of permissions) expect(ALL_PERMISSIONS).toContain(p);
    }
  });

  it('has the nine roles with the two-step defaults', () => {
    expect([...BUILT_IN_ROLE_KEYS]).toEqual([
      'OWNER',
      'PRINCIPAL',
      'ADMIN',
      'ACCOUNTANT',
      'TEACHER',
      'CLASS_TEACHER',
      'LIBRARIAN',
      'RECEPTIONIST',
      'TRANSPORT_MANAGER',
    ]);
    const two = BUILT_IN_ROLE_KEYS.filter((k) => BUILT_IN_ROLE_DEFAULTS[k].requiresTwoFactor);
    expect(two).toEqual(['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT']);
  });

  it('gives the Class Teacher everything the Teacher has, plus four', () => {
    const teacher = BUILT_IN_ROLE_DEFAULTS.TEACHER.permissions as readonly string[];
    const ct = BUILT_IN_ROLE_DEFAULTS.CLASS_TEACHER.permissions as readonly string[];
    for (const p of teacher) expect(ct).toContain(p);
    expect(ct.filter((p) => !teacher.includes(p)).sort()).toEqual(
      ['attendance.export', 'exams.approve', 'parents.view', 'students.edit'].sort(),
    );
  });

  it('gives the Principal everything but iam.manage and settings.manage', () => {
    const principal = BUILT_IN_ROLE_DEFAULTS.PRINCIPAL.permissions as readonly string[];
    expect([...principal].sort()).toEqual(
      ALL_PERMISSIONS.filter(
        (p) => p !== 'iam.manage' && p !== 'settings.manage' && p !== 'audit.view',
      ).sort(),
    );
  });

  it('adds audit.view to the catalogue, Admin and not Principal', () => {
    expect(ALL_PERMISSIONS).toContain('audit.view');
    const principal = BUILT_IN_ROLE_DEFAULTS.PRINCIPAL.permissions as readonly string[];
    expect(principal).not.toContain('audit.view');
    expect(principal).not.toContain('iam.manage');
    expect(principal).not.toContain('settings.manage');
    expect(BUILT_IN_ROLE_DEFAULTS.ADMIN.permissions).toContain('audit.view');
  });

  it('expands module wildcards from the spec', () => {
    expect(BUILT_IN_ROLE_DEFAULTS.ACCOUNTANT.permissions).toEqual(
      expect.arrayContaining([
        'fees.view',
        'fees.create',
        'fees.edit',
        'fees.approve',
        'fees.export',
      ]),
    );
    expect(BUILT_IN_ROLE_DEFAULTS.LIBRARIAN.permissions).toEqual(
      expect.arrayContaining(['library.view', 'library.manage']),
    );
  });
});

describe('presets', () => {
  it('builds the four presets', () => {
    expect(ROLE_PRESETS.readOnly.every((p) => p.endsWith('.view'))).toBe(true);
    expect(ROLE_PRESETS.readOnly).toHaveLength(PERMISSION_CATALOGUE.length);
    expect(ROLE_PRESETS.editor).toContain('students.edit');
    expect(ROLE_PRESETS.editor).not.toContain('students.delete');
    expect(ROLE_PRESETS.editor).not.toContain('students.export');
    expect(ROLE_PRESETS.manager).toContain('library.manage');
    expect(ROLE_PRESETS.manager).toContain('students.export');
    expect(ROLE_PRESETS.manager).not.toContain('students.delete');
    expect(ROLE_PRESETS.manager.some((p) => p.startsWith('iam.'))).toBe(false);
    expect(ROLE_PRESETS.fullAccess).toEqual(ALL_PERMISSIONS);
  });
});

describe('effectivePermissions', () => {
  it('gives the Owner every permission', () => {
    expect(effectivePermissions([{ key: 'OWNER', permissions: [] }])).toEqual(
      new Set(ALL_PERMISSIONS),
    );
  });

  it('unions several roles', () => {
    const result = effectivePermissions([
      { key: 'TEACHER', permissions: ['students.view', 'attendance.view'] },
      { key: 'LIBRARIAN', permissions: ['library.view', 'students.view'] },
      { key: null, permissions: ['reports.view'] },
    ]);
    expect([...result].sort()).toEqual(
      ['attendance.view', 'library.view', 'reports.view', 'students.view'].sort(),
    );
  });
});

describe('canGrant', () => {
  const actor = new Set(['students.view', 'students.edit']);
  it('refuses a key the actor lacks', () => {
    expect(canGrant(actor, ['students.view', 'fees.view'])).toBe(false);
  });
  it('allows a subset', () => {
    expect(canGrant(actor, ['students.view'])).toBe(true);
    expect(canGrant(actor, [])).toBe(true);
  });
});

describe('withImpliedView', () => {
  it('adds view for manage', () => {
    expect(withImpliedView(['library.manage'])).toEqual(
      expect.arrayContaining(['library.view', 'library.manage']),
    );
  });
  it('does not duplicate or invent', () => {
    const out = withImpliedView(['library.manage', 'library.view', 'students.edit']);
    expect(out.filter((p) => p === 'library.view')).toHaveLength(1);
    expect(out).not.toContain('students.view');
  });
});

describe('createRoleRequestSchema', () => {
  it('rejects unknown permission keys', () => {
    const base = { name: 'Front desk', permissions: ['students.view'], requiresTwoFactor: false };
    expect(createRoleRequestSchema.safeParse(base).success).toBe(true);
    expect(createRoleRequestSchema.safeParse({ ...base, permissions: ['nope.view'] }).success).toBe(
      false,
    );
  });
});

describe('schema limits', () => {
  const role = (over: object) => ({
    name: 'Front desk',
    permissions: ['students.view'],
    requiresTwoFactor: false,
    ...over,
  });
  const ok = (n: number) => 'a'.repeat(n);

  it('bounds the role name to 2-40 characters', () => {
    const results = [1, 2, 40, 41].map(
      (n) => createRoleRequestSchema.safeParse(role({ name: ok(n) })).success,
    );
    expect(results).toEqual([false, true, true, false]);
  });

  it('bounds the description to 200 characters', () => {
    expect(createRoleRequestSchema.safeParse(role({ description: ok(200) })).success).toBe(true);
    expect(createRoleRequestSchema.safeParse(role({ description: ok(201) })).success).toBe(false);
  });

  it('bounds the invitee name to 2-80 characters', () => {
    const results = [1, 2, 80, 81].map(
      (n) =>
        createInvitationRequestSchema.safeParse({ email: 'a@b.co', name: ok(n), roleIds: ['r1'] })
          .success,
    );
    expect(results).toEqual([false, true, true, false]);
  });

  it('requires at least one role id', () => {
    expect(
      createInvitationRequestSchema.safeParse({ email: 'a@b.co', name: 'Anita', roleIds: [] })
        .success,
    ).toBe(false);
    expect(setMemberRolesRequestSchema.safeParse({ roleIds: [] }).success).toBe(false);
  });

  it('trims and lower-cases the invitation email', () => {
    const parsed = createInvitationRequestSchema.parse({
      email: '  Anita@Example.COM ',
      name: 'Anita',
      roleIds: ['r1'],
    });
    expect(parsed.email).toBe('anita@example.com');
  });

  it('removes duplicate permissions and role ids', () => {
    expect(
      createRoleRequestSchema.parse(role({ permissions: ['students.view', 'students.view'] }))
        .permissions,
    ).toEqual(['students.view']);
    expect(setMemberRolesRequestSchema.parse({ roleIds: ['a', 'a', 'b'] }).roleIds).toEqual([
      'a',
      'b',
    ]);
  });

  it('needs at least one field to update a role', () => {
    expect(updateRoleRequestSchema.safeParse({}).success).toBe(false);
    expect(updateRoleRequestSchema.safeParse({ requiresTwoFactor: false }).success).toBe(true);
  });

  it('freezes the shared permission list', () => {
    expect(Object.isFrozen(ALL_PERMISSIONS)).toBe(true);
  });
});
