import {
  ALL_PERMISSIONS,
  IAM_ACTIONS,
  OWNER_ROLE_KEY,
  type PermissionCatalogueResponse,
  type Role,
  ROLE_PRESETS,
  withImpliedView,
} from '@classloom/contracts';

/** One module of `GET /iam/permissions`. */
export type CatalogueModule = PermissionCatalogueResponse['modules'][number];

export type PresetKey = keyof typeof ROLE_PRESETS;
export const PRESET_KEYS: readonly PresetKey[] = ['readOnly', 'editor', 'manager', 'fullAccess'];

export interface GridAction {
  key: string;
  checked: boolean;
  /** The viewer cannot grant it (or take it away). */
  disabled: boolean;
}

export interface GridModule {
  module: string;
  labelKey: string;
  actions: GridAction[];
  /** How many of the module's actions are ticked. */
  enabledCount: number;
  total: number;
}

/** The action of a `module.action` key. */
export const actionOf = (key: string) => key.slice(key.indexOf('.') + 1);

/**
 * What the grid draws: for each module its actions with their state, and the "x of y" count. A
 * key outside `grantable` is disabled, and stays ticked when the role holds it.
 */
export function gridState(
  catalogue: readonly CatalogueModule[],
  selected: ReadonlySet<string>,
  grantable: ReadonlySet<string>,
): GridModule[] {
  return catalogue.map((entry) => {
    const actions = entry.keys.map((key) => ({
      key,
      checked: selected.has(key),
      disabled: !grantable.has(key),
    }));
    return {
      module: entry.module,
      labelKey: entry.labelKey,
      actions,
      enabledCount: actions.filter((action) => action.checked).length,
      total: actions.length,
    };
  });
}

/** The column headers: the actions the catalogue uses, in the order of the contract's list. */
export function actionColumns(catalogue: readonly CatalogueModule[]): string[] {
  const used = new Set(catalogue.flatMap((entry) => entry.actions));
  const known: string[] = IAM_ACTIONS.filter((action) => used.has(action));
  return [...known, ...[...used].filter((action) => !known.includes(action))];
}

/**
 * Ticks or unticks one permission. `manage` brings `view` with it (when the viewer may grant it),
 * and `view` cannot go while `manage` is ticked. A key the viewer cannot grant never changes.
 */
export function toggleKey(
  selected: ReadonlySet<string>,
  key: string,
  checked: boolean,
  grantable: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!grantable.has(key) || selected.has(key) === checked) return selected;
  const next = new Set(selected);
  if (checked) {
    for (const implied of withImpliedView([key])) {
      if (grantable.has(implied)) next.add(implied);
    }
    return next;
  }
  if (key.endsWith('.view')) {
    const manage = `${key.slice(0, -'.view'.length)}.manage`;
    // `manage` stays when the viewer cannot take it away, and then so must its `view`.
    if (next.has(manage) && !grantable.has(manage)) return selected;
    next.delete(manage);
  }
  next.delete(key);
  return next;
}

/** "Select all" for a module: ticks every action the viewer can grant, or unticks them. */
export function toggleModule(
  catalogue: readonly CatalogueModule[],
  selected: ReadonlySet<string>,
  module: string,
  checked: boolean,
  grantable: ReadonlySet<string>,
): ReadonlySet<string> {
  const entry = catalogue.find((candidate) => candidate.module === module);
  if (!entry) return selected;
  const next = new Set(selected);
  for (const key of entry.keys) {
    if (!grantable.has(key)) continue;
    if (checked) {
      next.add(key);
      continue;
    }
    // `view` stays while a `manage` the viewer cannot take away stays (as in `toggleKey`).
    const manage = `${module}.manage`;
    if (key.endsWith('.view') && next.has(manage) && !grantable.has(manage)) continue;
    next.delete(key);
  }
  return next;
}

/** A preset's permissions, cut to what the viewer can grant. */
export function applyPreset(preset: PresetKey, grantable: ReadonlySet<string>): string[] {
  const held = ROLE_PRESETS[preset].filter((key) => grantable.has(key));
  return withImpliedView(held).filter((key) => grantable.has(key));
}

/** "42 of 64": Owner holds every permission whatever the API lists for it. */
export function permissionCount(role: Pick<Role, 'key' | 'permissions'>): {
  held: number;
  total: number;
} {
  const total = ALL_PERMISSIONS.length;
  return { held: role.key === OWNER_ROLE_KEY ? total : role.permissions.length, total };
}

export interface EditorAccess {
  /** Nothing in the form can be saved but the two-step switch, if that is on. */
  readOnly: boolean;
  name: boolean;
  description: boolean;
  permissions: boolean;
  twoFactor: boolean;
}

/**
 * What the viewer may change on a role (`null` is a new role). Everything needs `iam.manage`. A
 * built-in role keeps its name. Owner is fixed: its permissions and description cannot change, and
 * only an owner may change its two-step requirement.
 */
export function editorAccess(
  role: Pick<Role, 'key'> | null,
  viewer: { canManage: boolean; isOwner: boolean },
): EditorAccess {
  if (!viewer.canManage) {
    return {
      readOnly: true,
      name: false,
      description: false,
      permissions: false,
      twoFactor: false,
    };
  }
  if (role?.key === OWNER_ROLE_KEY) {
    return {
      readOnly: true,
      name: false,
      description: false,
      permissions: false,
      twoFactor: viewer.isOwner,
    };
  }
  return {
    readOnly: false,
    name: role?.key == null,
    description: true,
    permissions: true,
    twoFactor: true,
  };
}
