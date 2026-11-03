'use client';

import {
  getListMembersQueryKey,
  getListRolesQueryKey,
  useCreateRole,
  useUpdateRole,
} from '@classloom/api-client';
import {
  ALL_PERMISSIONS,
  createRoleRequestSchema,
  OWNER_ROLE_KEY,
  type Role,
  updateRoleRequestSchema,
} from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button, buttonVariants } from '@classloom/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@classloom/ui/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@classloom/ui/components/ui/field';
import { Input } from '@classloom/ui/components/ui/input';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { Switch } from '@classloom/ui/components/ui/switch';
import { Textarea } from '@classloom/ui/components/ui/textarea';
import { toast } from '@classloom/ui/components/ui/toast';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useId, useMemo, useRef, useState } from 'react';

import { Link, useRouter } from '@/i18n/navigation';

import { BUTTON_CLASS, CONTROL_CLASS } from '../auth/auth-ui';
import { DeleteRoleDialog, ResetRoleDialog } from './confirm-dialogs';
import {
  applyPreset,
  type CatalogueModule,
  editorAccess,
  type PresetKey,
  toggleKey,
  toggleModule,
} from './grid-helpers';
import { fieldErrorPaths, iamErrorOf, isStale } from './iam-errors';
import { useIamErrorText, usePermissionCatalogue, useRoles } from './iam-ui';
import type { Viewer } from './members-section';
import { PermissionGrid, PresetBar } from './permission-grid';

// The generated DTOs spell the permission keys as a literal union; the contract has validated them.
type UpdateData = Parameters<ReturnType<typeof useUpdateRole>['mutateAsync']>[0]['data'];
type CreateData = Parameters<ReturnType<typeof useCreateRole>['mutateAsync']>[0]['data'];

const NOT_CACHED = { mutation: { gcTime: 0 } } as const;
const ROLES_LIST = '/users-roles?tab=roles';
const NAME_MAX = 40;

type FieldName = 'name' | 'description';

interface RoleEditorProps {
  /** The role being edited; `null` for a new one. */
  roleId: string | null;
  /** A new role starts as a copy of this one. */
  cloneId?: string;
  viewer: Viewer;
}

/** The viewer's permissions as the set the grid checks against. */
const grantableOf = (viewer: Viewer): ReadonlySet<string> =>
  new Set(viewer.isOwner ? ALL_PERMISSIONS : viewer.permissions);

/**
 * `/users-roles/roles/[id]` and `/new`: loads the roles and the catalogue, then draws the form.
 * The form is remounted when the role is reloaded (someone else changed it, or it was reset).
 */
export function RoleEditor({ roleId, cloneId, viewer }: RoleEditorProps) {
  const t = useTranslations('iam.roleEditor');
  const roles = useRoles();
  const catalogue = usePermissionCatalogue();
  const queryClient = useQueryClient();
  const [reloads, setReloads] = useState(0);

  const reload = useCallback(() => {
    // Remount once the new list is in, so the form starts from what is stored.
    void queryClient
      .invalidateQueries({ queryKey: getListRolesQueryKey() })
      .then(() => setReloads((count) => count + 1));
  }, [queryClient]);

  if (roles.isError || catalogue.isError) {
    return (
      <Alert variant="destructive" className="flex flex-col items-start gap-3">
        <AlertDescription>{t('loadFailed')}</AlertDescription>
        <Button
          type="button"
          variant="outline"
          className={BUTTON_CLASS}
          onClick={() => {
            void roles.refetch();
            void catalogue.refetch();
          }}
        >
          {t('retry')}
        </Button>
      </Alert>
    );
  }
  if (!roles.data || !catalogue.data) {
    return (
      <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner aria-hidden="true" />
        {t('loading')}
      </p>
    );
  }

  const role = roleId ? (roles.data.find((candidate) => candidate.id === roleId) ?? null) : null;
  if (roleId && !role) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3">
          <p role="status">{t('notFound')}</p>
          <Link
            href={ROLES_LIST}
            className={buttonVariants({ variant: 'outline', className: BUTTON_CLASS })}
          >
            {t('back')}
          </Link>
        </CardContent>
      </Card>
    );
  }
  const source = cloneId
    ? (roles.data.find((candidate) => candidate.id === cloneId) ?? null)
    : null;

  return (
    <EditorForm
      key={`${role?.id ?? source?.id ?? 'new'}-${reloads}`}
      role={role}
      source={source}
      catalogue={catalogue.data}
      viewer={viewer}
      onReload={reload}
    />
  );
}

interface EditorFormProps {
  role: Role | null;
  source: Role | null;
  catalogue: readonly CatalogueModule[];
  viewer: Viewer;
  onReload: () => void;
}

function EditorForm({ role, source, catalogue, viewer, onReload }: EditorFormProps) {
  const t = useTranslations('iam.roleEditor');
  const errorText = useIamErrorText();
  const queryClient = useQueryClient();
  const router = useRouter();
  const create = useCreateRole(NOT_CACHED);
  const update = useUpdateRole(NOT_CACHED);
  const fieldId = useId();

  const canManage = viewer.permissions.includes('iam.manage');
  const access = editorAccess(role, { canManage, isOwner: viewer.isOwner });
  const grantable = useMemo(() => grantableOf(viewer), [viewer]);
  const isOwnerRole = role?.key === OWNER_ROLE_KEY;

  // What the form starts with: the role, or a copy of the source, or nothing. A copy leaves out
  // what the viewer cannot grant (the API would refuse it); an edit keeps those, fixed.
  const start = role ?? source;
  const initialPermissions = useMemo(() => {
    if (!start) return new Set<string>();
    const held = start.key === OWNER_ROLE_KEY ? ALL_PERMISSIONS : start.permissions;
    return new Set(role ? held : held.filter((key) => grantable.has(key)));
  }, [start, role, grantable]);
  const leftOut =
    !role &&
    source !== null &&
    initialPermissions.size <
      (source.key === OWNER_ROLE_KEY ? ALL_PERMISSIONS.length : source.permissions.length);

  const [name, setName] = useState(
    role ? role.name : source ? t('nameDefaultCopy', { name: source.name }).slice(0, NAME_MAX) : '',
  );
  const [description, setDescription] = useState(start?.description ?? '');
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(start?.requiresTwoFactor ?? false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(initialPermissions);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const submitting = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const resetTrigger = useRef<HTMLElement | null>(null);
  const deleteTrigger = useRef<HTMLElement | null>(null);

  const editable = access.name || access.description || access.permissions || access.twoFactor;
  const pending = create.isPending || update.isPending;

  const afterSave = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getListRolesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListMembersQueryKey() });
    // The person may hold this role: the server re-reads the session (their permissions).
    router.refresh();
  }, [queryClient, router]);

  function applyFieldErrors(paths: string[]): boolean {
    const next: Partial<Record<FieldName, string>> = {};
    for (const path of paths) {
      if (path === 'name' || path === 'description') next[path] = t(`errors.${path}`);
    }
    if (Object.keys(next).length === 0) return false;
    setErrors(next);
    if (next.name) nameRef.current?.focus();
    return true;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !editable) return;
    setErrors({});
    setFormError(null);

    const permissions = [...selected];
    const body = role
      ? {
          // Owner: only the two-step switch. A built-in role keeps its name.
          ...(access.name ? { name } : {}),
          ...(access.description ? { description } : {}),
          ...(access.permissions ? { permissions } : {}),
          ...(access.twoFactor ? { requiresTwoFactor } : {}),
        }
      : {
          name,
          description,
          permissions,
          requiresTwoFactor,
          // An empty list on a copy means "as the source has it", so a copy that was cleared
          // is sent as a new role instead.
          ...(source && permissions.length > 0 ? { cloneFromRoleId: source.id } : {}),
        };
    const parsed = (role ? updateRoleRequestSchema : createRoleRequestSchema).safeParse(body);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => String(issue.path[0]));
      if (!applyFieldErrors(paths)) setFormError(t('errors.validation'));
      return;
    }

    submitting.current = true;
    try {
      if (role) await update.mutateAsync({ id: role.id, data: parsed.data as UpdateData });
      else await create.mutateAsync({ data: parsed.data as CreateData });
      toast.add({
        title: t(role ? 'saved' : 'created', {
          name: access.name || !role ? name.trim() : role.name,
        }),
        type: 'success',
      });
      afterSave();
      router.push(ROLES_LIST);
    } catch (failure) {
      const outcome = iamErrorOf(failure);
      if (outcome === 'nameTaken') {
        setErrors({ name: errorText('nameTaken') });
        nameRef.current?.focus();
      } else if (outcome === 'roleChanged' || isStale(failure)) {
        // Someone else changed (or deleted) the role: show what is there now.
        toast.add({ title: t('changed'), type: 'error' });
        onReload();
      } else if (outcome === 'permissionDenied') {
        setFormError(t('errors.escalation'));
      } else if (fieldErrorPaths(failure).length > 0) {
        if (!applyFieldErrors(fieldErrorPaths(failure))) setFormError(t('errors.validation'));
      } else {
        setFormError(errorText(outcome));
      }
    } finally {
      submitting.current = false;
    }
  }

  const onPreset = (preset: PresetKey) =>
    setSelected((current) => {
      // What the viewer can't change stays as it is; the preset sets the rest.
      const kept = [...current].filter((key) => !grantable.has(key));
      return new Set([...kept, ...applyPreset(preset, grantable)]);
    });

  const dialogDone = (kind: 'reset' | 'delete') => (outcome: 'changed' | 'stale') => {
    afterSave();
    if (kind === 'delete' && outcome === 'changed') router.push(ROLES_LIST);
    else onReload();
  };

  const title = !role
    ? t('createTitle')
    : access.readOnly && !access.twoFactor
      ? t('viewTitle')
      : t('editTitle');
  const nameId = `${fieldId}-name`;
  const descriptionId = `${fieldId}-description`;
  const twoFactorId = `${fieldId}-two-factor`;
  const twoFactorHintId = `${twoFactorId}-hint`;
  const canClone = canManage && role !== null && (!isOwnerRole || viewer.isOwner);
  const canReset = canManage && role !== null && role.key !== null && !isOwnerRole;
  const canDelete = canManage && role !== null && role.key === null;

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      className="flex flex-col gap-6"
      aria-label={title}
    >
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-h5">
            <h2>{t('details')}</h2>
          </CardTitle>
          {role && (canClone || canReset || canDelete) ? (
            <div className="flex flex-wrap gap-2">
              {canClone ? (
                <Link
                  href={`/users-roles/roles/new?clone=${role.id}`}
                  className={buttonVariants({ variant: 'outline', className: BUTTON_CLASS })}
                >
                  {t('clone')}
                </Link>
              ) : null}
              {canReset ? (
                <Button
                  type="button"
                  variant="outline"
                  className={BUTTON_CLASS}
                  onClick={(event) => {
                    resetTrigger.current = event.currentTarget;
                    setResetting(role);
                  }}
                >
                  {t('reset')}
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  type="button"
                  variant="outline"
                  className={BUTTON_CLASS}
                  onClick={(event) => {
                    deleteTrigger.current = event.currentTarget;
                    setDeleting(role);
                  }}
                >
                  {t('delete')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {!canManage ? (
            <p className="text-muted-foreground text-sm">{t('readOnlyNote')}</p>
          ) : isOwnerRole ? (
            <p className="text-muted-foreground text-sm">{t('ownerNote')}</p>
          ) : null}
          {leftOut ? <p className="text-muted-foreground text-sm">{t('cloneNote')}</p> : null}
          <FieldGroup>
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor={nameId}>{t('name')}</FieldLabel>
              <Input
                ref={nameRef}
                id={nameId}
                autoComplete="off"
                className={CONTROL_CLASS}
                value={name}
                readOnly={!access.name}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={
                  errors.name
                    ? `${nameId}-error`
                    : role?.key && canManage && !isOwnerRole
                      ? `${nameId}-hint`
                      : undefined
                }
                onChange={(event) => setName(event.target.value)}
              />
              {role?.key && canManage && !isOwnerRole ? (
                <FieldDescription id={`${nameId}-hint`}>{t('builtInNote')}</FieldDescription>
              ) : null}
              <FieldError id={`${nameId}-error`}>{errors.name}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.description)}>
              <FieldLabel htmlFor={descriptionId}>{t('description')}</FieldLabel>
              <Textarea
                id={descriptionId}
                rows={2}
                value={description}
                readOnly={!access.description}
                aria-invalid={Boolean(errors.description)}
                aria-describedby={
                  errors.description ? `${descriptionId}-error` : `${descriptionId}-hint`
                }
                onChange={(event) => setDescription(event.target.value)}
              />
              {access.description ? (
                <FieldDescription id={`${descriptionId}-hint`}>
                  {t('descriptionHint')}
                </FieldDescription>
              ) : null}
              <FieldError id={`${descriptionId}-error`}>{errors.description}</FieldError>
            </Field>
          </FieldGroup>

          <div className="border-border flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <label htmlFor={twoFactorId} className="text-sm font-medium">
                {t('twoFactor')}
              </label>
              <p id={twoFactorHintId} className="text-muted-foreground text-xs">
                {t('twoFactorHint')}
                {isOwnerRole && !viewer.isOwner ? ` ${t('twoFactorOwnerOnly')}` : ''}
              </p>
            </div>
            <Switch
              id={twoFactorId}
              aria-describedby={twoFactorHintId}
              checked={requiresTwoFactor}
              disabled={!access.twoFactor}
              onCheckedChange={(next) => setRequiresTwoFactor(next)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-h5">
            <h2>{t('permissionsTitle')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {access.permissions ? <PresetBar disabled={pending} onPreset={onPreset} /> : null}
          <PermissionGrid
            catalogue={catalogue}
            selected={selected}
            grantable={grantable}
            readOnly={!access.permissions}
            onToggleKey={(key, checked) =>
              setSelected((current) => toggleKey(current, key, checked, grantable))
            }
            onToggleModule={(module, checked) =>
              setSelected((current) => toggleModule(catalogue, current, module, checked, grantable))
            }
          />
        </CardContent>
      </Card>

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription role="alert">{formError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Link
          href={ROLES_LIST}
          className={buttonVariants({ variant: 'outline', className: BUTTON_CLASS })}
        >
          {editable ? t('cancel') : t('back')}
        </Link>
        {editable ? (
          <Button type="submit" className={BUTTON_CLASS} disabled={pending}>
            {pending ? <Spinner aria-hidden="true" /> : null}
            {pending ? t('saving') : role ? t('save') : t('saveNew')}
          </Button>
        ) : null}
      </div>

      <ResetRoleDialog
        role={resetting}
        onClose={() => setResetting(null)}
        onDone={dialogDone('reset')}
        finalFocus={() => (resetTrigger.current?.isConnected ? resetTrigger.current : null)}
      />
      <DeleteRoleDialog
        role={deleting}
        onClose={() => setDeleting(null)}
        onDone={dialogDone('delete')}
        finalFocus={() => (deleteTrigger.current?.isConnected ? deleteTrigger.current : null)}
      />
    </form>
  );
}
