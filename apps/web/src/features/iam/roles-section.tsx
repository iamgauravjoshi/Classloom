'use client';

import { getListMembersQueryKey, getListRolesQueryKey } from '@classloom/api-client';
import { OWNER_ROLE_KEY, type Role } from '@classloom/contracts';
import { Badge } from '@classloom/ui/components/ui/badge';
import { Button, buttonVariants } from '@classloom/ui/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@classloom/ui/components/ui/card';
import { IconPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';

import { Link, useRouter } from '@/i18n/navigation';

import { BUTTON_CLASS } from '../auth/auth-ui';
import { keepFocusInSection, LoadState, SectionCard } from '../security/security-ui';
import { DeleteRoleDialog, ResetRoleDialog } from './confirm-dialogs';
import { permissionCount } from './grid-helpers';
import { useRoles } from './iam-ui';
import type { Viewer } from './members-section';

const LINK_CLASS = buttonVariants({ variant: 'outline', className: BUTTON_CLASS });

type Dialog = { kind: 'reset' | 'delete'; role: Role };

/** The Roles tab: a card per role, and "Create role", "Clone", "Edit", "Reset to default", "Delete". */
export function RolesSection({ viewer }: { viewer: Viewer }) {
  const t = useTranslations('iam.roles');
  const roles = useRoles();
  const queryClient = useQueryClient();
  const router = useRouter();
  const canManage = viewer.permissions.includes('iam.manage');

  // Focus returns to the card's button; when the card is gone, to the section's heading.
  const returnFocus = useRef<HTMLElement | null>(null);
  const finalFocus = useCallback(
    () =>
      returnFocus.current?.isConnected
        ? returnFocus.current
        : document.getElementById('roles-title'),
    [],
  );
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getListRolesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListMembersQueryKey() });
    // The person may hold the role: the server re-reads the session.
    router.refresh();
    keepFocusInSection('roles');
  }, [queryClient, router]);

  const open = (kind: Dialog['kind'], role: Role, trigger: HTMLElement) => {
    returnFocus.current = trigger;
    setDialog({ kind, role });
  };

  return (
    <SectionCard
      id="roles"
      title={t('title')}
      description={t('description')}
      action={
        canManage ? (
          <Link
            href="/users-roles/roles/new"
            className={buttonVariants({ className: BUTTON_CLASS })}
          >
            <IconPlus aria-hidden="true" />
            {t('create')}
          </Link>
        ) : undefined
      }
    >
      {roles.isError && !roles.data ? (
        <LoadState isError onRetry={() => void roles.refetch()} />
      ) : !roles.data ? (
        <LoadState isError={false} onRetry={() => void roles.refetch()} />
      ) : roles.data.length === 0 ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t('empty')}
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.data.map((role) => (
            <li key={role.id} className="flex">
              <RoleCard role={role} viewer={viewer} canManage={canManage} onOpen={open} />
            </li>
          ))}
        </ul>
      )}

      <ResetRoleDialog
        role={dialog?.kind === 'reset' ? dialog.role : null}
        onClose={() => setDialog(null)}
        onDone={reload}
        finalFocus={finalFocus}
      />
      <DeleteRoleDialog
        role={dialog?.kind === 'delete' ? dialog.role : null}
        onClose={() => setDialog(null)}
        onDone={reload}
        finalFocus={finalFocus}
      />
    </SectionCard>
  );
}

interface RoleCardProps {
  role: Role;
  viewer: Viewer;
  canManage: boolean;
  onOpen: (kind: Dialog['kind'], role: Role, trigger: HTMLElement) => void;
}

function RoleCard({ role, viewer, canManage, onOpen }: RoleCardProps) {
  const t = useTranslations('iam.roles');
  const { held, total } = permissionCount(role);
  const isOwnerRole = role.key === OWNER_ROLE_KEY;
  // Only an owner changes or copies Owner (its two-step setting is all that can change).
  const mayUse = canManage && (!isOwnerRole || viewer.isOwner);
  const builtIn = role.key !== null;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-h6">
          <h3>
            <Link
              href={`/users-roles/roles/${role.id}`}
              className="focus-visible:ring-ring/50 rounded-sm outline-none hover:underline focus-visible:ring-3"
            >
              {role.name}
            </Link>
          </h3>
        </CardTitle>
        {role.description ? <CardDescription>{role.description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-3">
        <ul className="flex flex-wrap gap-1.5">
          <li>
            <Badge variant="secondary">{builtIn ? t('builtIn') : t('custom')}</Badge>
          </li>
          {role.requiresTwoFactor ? (
            <li>
              <Badge variant="outline">{t('requiresTwoFactor')}</Badge>
            </li>
          ) : null}
        </ul>
        <p className="text-muted-foreground text-sm">
          {t('members', { count: role.memberCount })}
          <span aria-hidden="true"> · </span>
          {t('permissions', { held, total })}
        </p>
        {mayUse ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/users-roles/roles/new?clone=${role.id}`}
              aria-label={`${t('clone')} ${role.name}`}
              className={LINK_CLASS}
            >
              {t('clone')}
            </Link>
            <Link
              href={`/users-roles/roles/${role.id}`}
              aria-label={`${t('edit')} ${role.name}`}
              className={LINK_CLASS}
            >
              {t('edit')}
            </Link>
            {builtIn && !isOwnerRole ? (
              <Button
                type="button"
                variant="outline"
                className={BUTTON_CLASS}
                aria-label={`${t('reset')}: ${role.name}`}
                onClick={(event) => onOpen('reset', role, event.currentTarget)}
              >
                {t('reset')}
              </Button>
            ) : null}
            {!builtIn ? (
              <Button
                type="button"
                variant="outline"
                className={BUTTON_CLASS}
                aria-label={`${t('delete')} ${role.name}`}
                onClick={(event) => onOpen('delete', role, event.currentTarget)}
              >
                {t('delete')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
