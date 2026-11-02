import { z } from 'zod';

import { emailField } from './fields';

/* ------------------------------------------------------------------ */
/* Permission catalogue (spec §4)                                      */
/* ------------------------------------------------------------------ */

export const IAM_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'export',
  'approve',
  'manage',
] as const;
export type IamAction = (typeof IAM_ACTIONS)[number];

export const IAM_MODULES = [
  'dashboard',
  'students',
  'admissions',
  'parents',
  'staff',
  'classes',
  'subjects',
  'timetable',
  'attendance',
  'exams',
  'fees',
  'library',
  'transport',
  'communication',
  'reports',
  'settings',
  'iam',
] as const;
export type IamModule = (typeof IAM_MODULES)[number];

export const PERMISSION_CATALOGUE: readonly {
  module: IamModule;
  actions: readonly IamAction[];
}[] = [
  { module: 'dashboard', actions: ['view'] },
  { module: 'students', actions: ['view', 'create', 'edit', 'delete', 'export'] },
  { module: 'admissions', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export'] },
  { module: 'parents', actions: ['view', 'create', 'edit', 'delete'] },
  { module: 'staff', actions: ['view', 'create', 'edit', 'delete', 'export'] },
  { module: 'classes', actions: ['view', 'manage'] },
  { module: 'subjects', actions: ['view', 'manage'] },
  { module: 'timetable', actions: ['view', 'manage'] },
  { module: 'attendance', actions: ['view', 'create', 'edit', 'export'] },
  { module: 'exams', actions: ['view', 'create', 'edit', 'approve', 'export'] },
  { module: 'fees', actions: ['view', 'create', 'edit', 'approve', 'export'] },
  { module: 'library', actions: ['view', 'manage'] },
  { module: 'transport', actions: ['view', 'manage'] },
  { module: 'communication', actions: ['view', 'create', 'approve'] },
  { module: 'reports', actions: ['view', 'export'] },
  { module: 'settings', actions: ['view', 'manage'] },
  { module: 'iam', actions: ['view', 'manage'] },
];

export const ALL_PERMISSIONS: readonly string[] = Object.freeze(
  PERMISSION_CATALOGUE.flatMap((m) => m.actions.map((a) => `${m.module}.${a}`)),
);

/** A permission key, `module.action`. Validate with `permissionSchema`. */
export type Permission = string;

export const permissionSchema = z.enum(ALL_PERMISSIONS as [string, ...string[]]);

/** Every action the catalogue lists for a module, as keys. */
function moduleKeys(module: IamModule): string[] {
  const entry = PERMISSION_CATALOGUE.find((m) => m.module === module);
  return entry ? entry.actions.map((a) => `${module}.${a}`) : [];
}

/* ------------------------------------------------------------------ */
/* Built-in roles (spec §5)                                            */
/* ------------------------------------------------------------------ */

/** The Owner role's key. Owner has no stored permissions: it means every permission. */
export const OWNER_ROLE_KEY = 'OWNER';

export const BUILT_IN_ROLE_KEYS = [
  OWNER_ROLE_KEY,
  'PRINCIPAL',
  'ADMIN',
  'ACCOUNTANT',
  'TEACHER',
  'CLASS_TEACHER',
  'LIBRARIAN',
  'RECEPTIONIST',
  'TRANSPORT_MANAGER',
] as const;
export type BuiltInRoleKey = (typeof BUILT_IN_ROLE_KEYS)[number];

const TEACHER_PERMISSIONS: readonly string[] = [
  'dashboard.view',
  'students.view',
  'classes.view',
  'subjects.view',
  'timetable.view',
  'attendance.view',
  'attendance.create',
  'attendance.edit',
  'exams.view',
  'exams.create',
  'exams.edit',
  'communication.view',
  'communication.create',
];

export const BUILT_IN_ROLE_DEFAULTS: Record<
  BuiltInRoleKey,
  {
    name: string;
    description: string;
    permissions: readonly string[] | 'ALL';
    requiresTwoFactor: boolean;
  }
> = {
  OWNER: {
    name: 'Owner',
    description: 'Has full control of the school, including users and roles.',
    permissions: 'ALL',
    requiresTwoFactor: true,
  },
  PRINCIPAL: {
    name: 'Principal',
    description: 'Oversees the whole school but cannot manage users or school settings.',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'iam.manage' && p !== 'settings.manage'),
    requiresTwoFactor: true,
  },
  ADMIN: {
    name: 'Admin',
    description: 'Runs the school office with access to every module.',
    permissions: [...ALL_PERMISSIONS],
    requiresTwoFactor: true,
  },
  ACCOUNTANT: {
    name: 'Accountant',
    description: 'Manages fees and reads financial reports.',
    permissions: [
      'dashboard.view',
      'students.view',
      'parents.view',
      ...moduleKeys('fees'),
      'reports.view',
      'reports.export',
    ],
    requiresTwoFactor: true,
  },
  TEACHER: {
    name: 'Teacher',
    description: 'Takes attendance, enters marks and messages classes.',
    permissions: TEACHER_PERMISSIONS,
    requiresTwoFactor: false,
  },
  CLASS_TEACHER: {
    name: 'Class Teacher',
    description: 'Does what a teacher does, and also looks after one class.',
    permissions: [
      ...TEACHER_PERMISSIONS,
      'students.edit',
      'attendance.export',
      'exams.approve',
      'parents.view',
    ],
    requiresTwoFactor: false,
  },
  LIBRARIAN: {
    name: 'Librarian',
    description: 'Looks after the library.',
    permissions: ['dashboard.view', 'students.view', 'staff.view', ...moduleKeys('library')],
    requiresTwoFactor: false,
  },
  RECEPTIONIST: {
    name: 'Receptionist',
    description: 'Handles admission enquiries and front desk work.',
    permissions: [
      'dashboard.view',
      'admissions.view',
      'admissions.create',
      'admissions.edit',
      'students.view',
      'parents.view',
      'parents.create',
      'communication.view',
    ],
    requiresTwoFactor: false,
  },
  TRANSPORT_MANAGER: {
    name: 'Transport Manager',
    description: 'Manages buses and routes.',
    permissions: ['dashboard.view', 'students.view', ...moduleKeys('transport')],
    requiresTwoFactor: false,
  },
};

/* ------------------------------------------------------------------ */
/* Presets for the role editor (spec §11)                              */
/* ------------------------------------------------------------------ */

export const ROLE_PRESETS: {
  readOnly: readonly string[];
  editor: readonly string[];
  manager: readonly string[];
  fullAccess: readonly string[];
} = {
  readOnly: ALL_PERMISSIONS.filter((p) => p.endsWith('.view')),
  editor: ALL_PERMISSIONS.filter((p) => /\.(view|create|edit)$/.test(p)),
  manager: ALL_PERMISSIONS.filter((p) => !p.endsWith('.delete') && !p.startsWith('iam.')),
  fullAccess: [...ALL_PERMISSIONS],
};

/* ------------------------------------------------------------------ */
/* Pure functions                                                      */
/* ------------------------------------------------------------------ */

/** The union of the roles' permissions. Owner gives every permission. */
export function effectivePermissions(
  roles: readonly { key: string | null; permissions: readonly string[] }[],
): Set<string> {
  const result = new Set<string>();
  for (const role of roles) {
    if (role.key === OWNER_ROLE_KEY) return new Set(ALL_PERMISSIONS);
    for (const p of role.permissions) result.add(p);
  }
  return result;
}

/** True when the actor holds every wanted permission (no escalation). */
export function canGrant(actor: ReadonlySet<string>, wanted: Iterable<string>): boolean {
  for (const p of wanted) if (!actor.has(p)) return false;
  return true;
}

/** `module.manage` implies `module.view`; used by the role grid. */
export function withImpliedView(perms: Iterable<string>): string[] {
  const out = new Set<string>(perms);
  for (const p of [...out]) {
    if (p.endsWith('.manage')) {
      const view = `${p.slice(0, -'.manage'.length)}.view`;
      if (ALL_PERMISSIONS.includes(view)) out.add(view);
    }
  }
  return [...out];
}

/* ------------------------------------------------------------------ */
/* Schemas (spec §8-9)                                                 */
/* ------------------------------------------------------------------ */

const unique = <T extends string>(xs: T[]): T[] => [...new Set(xs)];
const permissionsField = z
  .array(permissionSchema)
  .max(ALL_PERMISSIONS.length * 2)
  .transform(unique);
const roleIdsField = z.array(z.string()).min(1).transform(unique);
const roleNameField = z.string().trim().min(2).max(40);
const roleDescriptionField = z.string().trim().max(200);
const personNameField = z.string().trim().min(2).max(80);

export const roleSchema = z.object({
  id: z.string(),
  key: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  requiresTwoFactor: z.boolean(),
  permissions: z.array(z.string()),
  memberCount: z.number().int().nonnegative(),
});
export type Role = z.infer<typeof roleSchema>;

export const rolesResponseSchema = z.object({ roles: z.array(roleSchema) });
export type RolesResponse = z.infer<typeof rolesResponseSchema>;

export const createRoleRequestSchema = z.object({
  name: roleNameField,
  description: roleDescriptionField.optional(),
  permissions: permissionsField,
  requiresTwoFactor: z.boolean(),
  cloneFromRoleId: z.string().optional(),
});
export type CreateRoleRequest = z.infer<typeof createRoleRequestSchema>;

export const updateRoleRequestSchema = z
  .object({
    name: roleNameField.optional(),
    description: roleDescriptionField.optional(),
    permissions: permissionsField.optional(),
    requiresTwoFactor: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Change at least one field',
  });
export type UpdateRoleRequest = z.infer<typeof updateRoleRequestSchema>;

export const permissionCatalogueResponseSchema = z.object({
  modules: z.array(
    z.object({
      module: z.string(),
      actions: z.array(z.string()),
      keys: z.array(z.string()),
      labelKey: z.string(),
    }),
  ),
});
export type PermissionCatalogueResponse = z.infer<typeof permissionCatalogueResponseSchema>;

export const MEMBER_STATUSES = ['ACTIVE', 'DEACTIVATED', 'REVOKED'] as const;

export const memberSchema = z.object({
  membershipId: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  roles: z.array(z.object({ id: z.string(), key: z.string().nullable(), name: z.string() })),
  status: z.enum(MEMBER_STATUSES),
  twoFactorEnabled: z.boolean(),
  lastSignInAt: z.iso.datetime().nullable(),
});
export type Member = z.infer<typeof memberSchema>;

export const membersPageSchema = z.object({
  members: z.array(memberSchema),
  nextCursor: z.string().nullable(),
});
export type MembersPage = z.infer<typeof membersPageSchema>;

/** `GET /iam/members` filters. `status` omitted lists ACTIVE and DEACTIVATED (REVOKED is hidden). */
export const listMembersQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  roleId: z.string().optional(),
  status: z.enum(MEMBER_STATUSES).optional(),
  cursor: z.string().max(500).optional(),
});
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;

export const setMemberRolesRequestSchema = z.object({
  roleIds: roleIdsField,
});
export type SetMemberRolesRequest = z.infer<typeof setMemberRolesRequestSchema>;

export const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  roles: z.array(z.object({ id: z.string(), name: z.string() })),
  expiresAt: z.iso.datetime(),
  invitedBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const createInvitationRequestSchema = z.object({
  email: emailField,
  name: personNameField,
  roleIds: roleIdsField,
});
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;

export const invitationPreviewSchema = z.object({
  school: z.object({ code: z.string(), name: z.string() }),
  email: z.string(),
  name: z.string(),
  roles: z.array(z.string()),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

export const acceptInvitationRequestSchema = z.object({
  token: z.string().min(1).max(256),
});
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;
