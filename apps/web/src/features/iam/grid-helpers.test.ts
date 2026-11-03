import {
  ALL_PERMISSIONS,
  OWNER_ROLE_KEY,
  PERMISSION_CATALOGUE,
  type Role,
} from '@classloom/contracts';
import { describe, expect, it } from 'vitest';

import {
  actionColumns,
  applyPreset,
  editorAccess,
  gridState,
  permissionCount,
  toggleKey,
  toggleModule,
} from './grid-helpers';

const catalogue = PERMISSION_CATALOGUE.map((entry) => ({
  module: entry.module,
  actions: [...entry.actions],
  keys: entry.actions.map((action) => `${entry.module}.${action}`),
  labelKey: `iam.permissions.modules.${entry.module}`,
}));
const everything = new Set(ALL_PERMISSIONS);

const role = (over: Partial<Role> = {}): Role => ({
  id: 'r1',
  key: null,
  name: 'Front desk',
  description: '',
  requiresTwoFactor: false,
  permissions: [],
  memberCount: 0,
  ...over,
});

describe('gridState', () => {
  it('counts the ticked actions of each module against its total', () => {
    const state = gridState(catalogue, new Set(['students.view', 'students.edit']), everything);
    const students = state.find((m) => m.module === 'students');
    expect(students?.enabledCount).toBe(2);
    expect(students?.total).toBe(5);
    expect(students?.actions.map((a) => [a.key, a.checked])).toEqual([
      ['students.view', true],
      ['students.create', false],
      ['students.edit', true],
      ['students.delete', false],
      ['students.export', false],
    ]);
    expect(state.find((m) => m.module === 'dashboard')).toMatchObject({
      enabledCount: 0,
      total: 1,
    });
  });

  it('marks the keys outside what the viewer can grant as disabled', () => {
    const grantable = new Set(['students.view', 'students.create']);
    const students = gridState(catalogue, new Set(), grantable).find(
      (m) => m.module === 'students',
    );
    expect(students?.actions.map((a) => [a.key, a.disabled])).toEqual([
      ['students.view', false],
      ['students.create', false],
      ['students.edit', true],
      ['students.delete', true],
      ['students.export', true],
    ]);
  });

  it('keeps a ticked key the viewer cannot grant ticked, and disabled', () => {
    const state = gridState(catalogue, new Set(['fees.approve']), new Set(['fees.view']));
    const approve = state
      .find((m) => m.module === 'fees')
      ?.actions.find((a) => a.key === 'fees.approve');
    expect(approve).toEqual({ key: 'fees.approve', checked: true, disabled: true });
  });
});

describe('toggleKey', () => {
  it('ticking manage ticks view', () => {
    const next = toggleKey(new Set(), 'classes.manage', true, everything);
    expect([...next].sort()).toEqual(['classes.manage', 'classes.view']);
  });

  it('unticking view unticks manage, which needs it', () => {
    const next = toggleKey(
      new Set(['classes.view', 'classes.manage']),
      'classes.view',
      false,
      everything,
    );
    expect([...next]).toEqual([]);
  });

  it('unticking manage leaves view', () => {
    const next = toggleKey(
      new Set(['classes.view', 'classes.manage']),
      'classes.manage',
      false,
      everything,
    );
    expect([...next]).toEqual(['classes.view']);
  });

  it('does not change a key the viewer cannot grant', () => {
    const start = new Set(['fees.approve']);
    expect(toggleKey(start, 'fees.approve', false, new Set(['fees.view']))).toBe(start);
    expect(toggleKey(new Set(), 'fees.edit', true, new Set(['fees.view'])).size).toBe(0);
  });

  it('does not add the implied view when the viewer cannot grant it', () => {
    const next = toggleKey(new Set(), 'classes.manage', true, new Set(['classes.manage']));
    expect([...next]).toEqual(['classes.manage']);
  });
});

describe('toggleModule', () => {
  it('ticks every action the viewer can grant, and unticks them again', () => {
    const grantable = new Set(['students.view', 'students.create', 'students.edit']);
    const on = toggleModule(catalogue, new Set(), 'students', true, grantable);
    expect([...on].sort()).toEqual(['students.create', 'students.edit', 'students.view']);
    const off = toggleModule(catalogue, on, 'students', false, grantable);
    expect([...off]).toEqual([]);
  });

  it('leaves a ticked key the viewer cannot grant, and other modules, alone', () => {
    const start = new Set(['students.delete', 'fees.view']);
    const off = toggleModule(catalogue, start, 'students', false, new Set(['students.view']));
    expect([...off].sort()).toEqual(['fees.view', 'students.delete']);
  });
});

describe('toggleModule, with a manage the viewer cannot take away', () => {
  it('keeps view while that manage stays', () => {
    const start = new Set(['classes.view', 'classes.manage']);
    const off = toggleModule(catalogue, start, 'classes', false, new Set(['classes.view']));
    expect([...off].sort()).toEqual(['classes.manage', 'classes.view']);
  });
});

describe('applyPreset', () => {
  it('adds the view a manage implies, where the viewer can grant it', () => {
    const keys = applyPreset('manager', new Set(['classes.manage', 'classes.view']));
    expect(keys.sort()).toEqual(['classes.manage', 'classes.view']);
    expect(applyPreset('manager', new Set(['classes.manage']))).toEqual(['classes.manage']);
  });

  it('gives the preset when the viewer can grant all of it', () => {
    expect(applyPreset('readOnly', everything)).toEqual(
      ALL_PERMISSIONS.filter((p) => p.endsWith('.view')),
    );
    expect(applyPreset('fullAccess', everything)).toEqual([...ALL_PERMISSIONS]);
  });

  it('keeps full access to what an admin without iam.manage can grant', () => {
    const grantable = new Set(ALL_PERMISSIONS.filter((p) => p !== 'iam.manage'));
    const keys = applyPreset('fullAccess', grantable);
    expect(keys).not.toContain('iam.manage');
    expect(keys).toContain('iam.view');
    expect(keys).toHaveLength(ALL_PERMISSIONS.length - 1);
  });

  it('keeps the manager preset free of delete and iam', () => {
    const keys = applyPreset('manager', everything);
    expect(keys.some((p) => p.endsWith('.delete') || p.startsWith('iam.'))).toBe(false);
    expect(keys).toContain('classes.manage');
  });

  it('returns nothing the viewer lacks', () => {
    expect(applyPreset('editor', new Set(['students.view', 'fees.delete']))).toEqual([
      'students.view',
    ]);
  });
});

describe('actionColumns', () => {
  it('lists the actions the catalogue uses, in the catalogue order', () => {
    expect(actionColumns(catalogue)).toEqual([
      'view',
      'create',
      'edit',
      'delete',
      'export',
      'approve',
      'manage',
    ]);
  });
});

describe('permissionCount', () => {
  it('counts a role against the whole catalogue, and Owner as everything', () => {
    expect(permissionCount(role({ permissions: ['students.view', 'fees.view'] }))).toEqual({
      held: 2,
      total: ALL_PERMISSIONS.length,
    });
    expect(permissionCount(role({ key: OWNER_ROLE_KEY, permissions: [] }))).toEqual({
      held: ALL_PERMISSIONS.length,
      total: ALL_PERMISSIONS.length,
    });
  });
});

describe('editorAccess', () => {
  const manager = { canManage: true, isOwner: false };

  it('lets a manager change everything of a custom role', () => {
    expect(editorAccess(role(), manager)).toEqual({
      readOnly: false,
      name: true,
      description: true,
      permissions: true,
      twoFactor: true,
    });
  });

  it('keeps the name of a built-in role', () => {
    const access = editorAccess(role({ key: 'TEACHER' }), manager);
    expect(access).toMatchObject({ name: false, description: true, permissions: true });
  });

  it('makes the Owner role read-only, but for the two-step switch, which only an owner has', () => {
    const owner = role({ key: OWNER_ROLE_KEY });
    expect(editorAccess(owner, manager)).toEqual({
      readOnly: true,
      name: false,
      description: false,
      permissions: false,
      twoFactor: false,
    });
    expect(editorAccess(owner, { canManage: true, isOwner: true })).toEqual({
      readOnly: true,
      name: false,
      description: false,
      permissions: false,
      twoFactor: true,
    });
  });

  it('makes every role read-only without iam.manage, Owner too', () => {
    const viewer = { canManage: false, isOwner: true };
    expect(editorAccess(role(), viewer)).toEqual({
      readOnly: true,
      name: false,
      description: false,
      permissions: false,
      twoFactor: false,
    });
    expect(editorAccess(role({ key: OWNER_ROLE_KEY }), viewer).twoFactor).toBe(false);
  });

  it('lets a manager fill in a new role', () => {
    expect(editorAccess(null, manager)).toMatchObject({ readOnly: false, name: true });
  });
});
