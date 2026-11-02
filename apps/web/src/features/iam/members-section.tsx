'use client';

import {
  getListInvitationsQueryKey,
  getListMembersQueryKey,
  getListRolesQueryKey,
  listMembers,
  useListInvitations,
  useReactivateMember,
  useResendInvitation,
} from '@classloom/api-client';
import {
  type Invitation,
  invitationsResponseSchema,
  type ListMembersQuery,
  membersPageSchema,
} from '@classloom/contracts';
import { StatusPill, type StatusTone } from '@classloom/ui/components/status-pill';
import { Avatar, AvatarFallback } from '@classloom/ui/components/ui/avatar';
import { Badge } from '@classloom/ui/components/ui/badge';
import { Button } from '@classloom/ui/components/ui/button';
import { Input } from '@classloom/ui/components/ui/input';
import { Label } from '@classloom/ui/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@classloom/ui/components/ui/select';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { IconSearch } from '@tabler/icons-react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useRef, useState } from 'react';

import { BUTTON_CLASS, CONTROL_CLASS } from '../auth/auth-ui';
import { useDebouncedValue } from '../school-registration/use-debounced-value';
import {
  keepFocusInSection,
  LoadState,
  SectionCard,
  useSecurityDates,
} from '../security/security-ui';
import { ChangeRolesDialog } from './change-roles-dialog';
import { DeactivateDialog, ResetTwoFactorDialog, RevokeInvitationDialog } from './confirm-dialogs';
import { iamErrorOf } from './iam-errors';
import { useIamErrorText, useRoles } from './iam-ui';
import { InviteDialog } from './invite-dialog';
import { MemberRowMenu } from './member-row-menu';
import {
  actionsFor,
  assignableRoles,
  filterInvitations,
  type InviteRow,
  type MemberRow,
  mergeMembersAndInvites,
  type Row,
  type RowAction,
  type RowStatus,
} from './members-model';

const TRIGGER_CLASS = `w-full ${CONTROL_CLASS} data-[size=default]:h-10`;
const ALL = 'all';

type StatusFilter = typeof ALL | 'ACTIVE' | 'INVITED' | 'DEACTIVATED';
const STATUS_FILTERS: StatusFilter[] = [ALL, 'ACTIVE', 'INVITED', 'DEACTIVATED'];

const TONES: Record<RowStatus, StatusTone> = {
  ACTIVE: 'success',
  INVITED: 'info',
  DEACTIVATED: 'neutral',
  REVOKED: 'danger',
};

export interface Viewer {
  userId: string;
  permissions: string[];
  isOwner: boolean;
  schoolCode: string;
}

/** The key every page of the list lives under; invalidating `getListMembersQueryKey()` reloads it. */
const membersKey = (query: ListMembersQuery) =>
  [...getListMembersQueryKey(query), 'infinite'] as const;

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .filter((_, index, parts) => index === 0 || index === parts.length - 1)
    .join('')
    .toUpperCase();

type Dialog =
  | { kind: 'roles'; row: MemberRow }
  | { kind: 'deactivate'; row: MemberRow }
  | { kind: 'reset'; row: MemberRow }
  | { kind: 'revoke'; row: InviteRow };

/** The Members tab: filters, the people and pending invitations in one list, and their actions. */
export function MembersSection({ viewer }: { viewer: Viewer }) {
  const t = useTranslations('iam.members');
  const dates = useSecurityDates();
  const errorText = useIamErrorText();
  const queryClient = useQueryClient();
  const canManage = viewer.permissions.includes('iam.manage');

  const [search, setSearch] = useState('');
  const [roleId, setRoleId] = useState<string>(ALL);
  const [status, setStatus] = useState<StatusFilter>(ALL);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const query: ListMembersQuery = {
    search: debouncedSearch || undefined,
    roleId: roleId === ALL ? undefined : roleId,
    status: status === 'ACTIVE' || status === 'DEACTIVATED' ? status : undefined,
  };

  const showMembers = status !== 'INVITED';
  const showInvites = status === ALL || status === 'INVITED';

  const members = useInfiniteQuery({
    queryKey: membersKey(query),
    queryFn: async ({ pageParam, signal }) =>
      membersPageSchema.parse(
        await listMembers(pageParam ? { ...query, cursor: pageParam } : query, signal),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: showMembers,
  });
  const invitations = useListInvitations({
    query: {
      select: (data): Invitation[] => invitationsResponseSchema.parse(data).invitations,
      enabled: showInvites,
    },
  });
  const roles = useRoles();

  const rows = useMemo<Row[]>(() => {
    const people = showMembers ? (members.data?.pages.flatMap((page) => page.members) ?? []) : [];
    const invited = showInvites
      ? filterInvitations(invitations.data ?? [], {
          search: query.search,
          roleId: query.roleId,
        })
      : [];
    return mergeMembersAndInvites(people, invited);
  }, [members.data, invitations.data, showMembers, showInvites, query.search, query.roleId]);

  const ready = (!showMembers || members.data) && (!showInvites || invitations.data);
  const failed = (showMembers && members.isError) || (showInvites && invitations.isError);
  const filtering = Boolean(query.search || query.roleId || status !== ALL);

  const assignable = useMemo(
    () => assignableRoles(roles.data ?? [], viewer.permissions, viewer.isOwner),
    [roles.data, viewer.permissions, viewer.isOwner],
  );
  const assignableIds = useMemo(() => new Set(assignable.map((role) => role.id)), [assignable]);

  // Focus returns to the row's menu button; when the row is gone, to the section's heading.
  const returnFocus = useRef<HTMLElement | null>(null);
  const finalFocus = useCallback(
    () =>
      returnFocus.current?.isConnected
        ? returnFocus.current
        : document.getElementById('members-title'),
    [],
  );
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const closeDialog = () => setDialog(null);

  const reactivate = useReactivateMember();
  const resend = useResendInvitation();

  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getListMembersQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListInvitationsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListRolesQueryKey() });
  }, [queryClient]);

  async function onAction(action: RowAction, row: Row, trigger: HTMLElement | null) {
    returnFocus.current = trigger;
    try {
      if (action === 'reactivate' && row.kind === 'member') {
        await reactivate.mutateAsync({ membershipId: row.membershipId });
        toast.add({ title: t('reactivatedToast', { name: row.name }), type: 'success' });
        reload();
        keepFocusInSection('members');
      } else if (action === 'resend' && row.kind === 'invite') {
        await resend.mutateAsync({ invitationId: row.invitationId });
        toast.add({ title: t('resentToast', { email: row.email }), type: 'success' });
        reload();
      } else if (
        (action === 'roles' || action === 'deactivate' || action === 'reset') &&
        row.kind === 'member'
      ) {
        setDialog({ kind: action, row });
      } else if (action === 'revoke' && row.kind === 'invite') {
        setDialog({ kind: 'revoke', row });
      }
    } catch (failure) {
      toast.add({ title: errorText(iamErrorOf(failure)), type: 'error' });
      reload();
    }
  }

  const statusItems = STATUS_FILTERS.map((value) => ({
    value,
    label: value === ALL ? t('allStatuses') : t(`status.${value}`),
  }));
  const roleItems = [
    { value: ALL, label: t('allRoles') },
    ...(roles.data ?? []).map((role) => ({ value: role.id, label: role.name })),
  ];

  const roleLabels = (row: Row) =>
    row.roles.length === 0 ? (
      <span className="text-muted-foreground">{t('noRoles')}</span>
    ) : (
      <ul className="flex flex-wrap gap-1" aria-label={t('roles')}>
        {row.roles.map((role) => (
          <li key={role.id}>
            <Badge variant="outline">{role.name}</Badge>
          </li>
        ))}
      </ul>
    );
  const statusPill = (row: Row) => (
    <StatusPill tone={TONES[row.status]}>{t(`status.${row.status}`)}</StatusPill>
  );
  const twoStep = (row: Row) =>
    row.kind === 'invite' ? (
      <span aria-hidden="true">–</span>
    ) : row.twoFactorEnabled ? (
      t('twoStepOn')
    ) : (
      t('twoStepOff')
    );
  const lastSignIn = (row: Row) =>
    row.kind === 'invite'
      ? t('expires', { date: dates.day(row.expiresAt) })
      : row.lastSignInAt
        ? dates.dateTime(row.lastSignInAt)
        : t('never');
  const menu = (row: Row) => (
    <MemberRowMenu
      row={row}
      actions={actionsFor(row, { canManage, isOwner: viewer.isOwner, userId: viewer.userId })}
      onAction={(action, target, trigger) => void onAction(action, target, trigger)}
    />
  );
  const person = (row: Row) => (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar>
        <AvatarFallback>{initialsOf(row.name)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col">
        <span className="flex flex-wrap items-center gap-2 font-medium">
          <span className="break-words">{row.name}</span>
          {row.kind === 'member' && row.userId === viewer.userId ? (
            <Badge variant="secondary">{t('you')}</Badge>
          ) : null}
        </span>
        <span className="text-muted-foreground text-sm break-all">{row.email}</span>
      </div>
    </div>
  );

  return (
    <SectionCard
      id="members"
      title={t('title')}
      description={t('description')}
      action={
        canManage ? (
          <InviteDialog roles={roles.data ? assignable : undefined} rolesFailed={roles.isError} />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem_12rem]">
          <div className="relative">
            <Label htmlFor="members-search" className="sr-only">
              {t('search')}
            </Label>
            <IconSearch
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            />
            <Input
              id="members-search"
              type="search"
              autoComplete="off"
              className={`${CONTROL_CLASS} pl-9`}
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="members-role" className="sr-only">
              {t('roleFilter')}
            </Label>
            <Select
              items={roleItems}
              value={roleId}
              onValueChange={(value) => setRoleId(value ?? ALL)}
            >
              <SelectTrigger id="members-role" className={TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {roleItems.map((item) => (
                  <SelectItem key={item.value} value={item.value} className="pointer-coarse:py-2.5">
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="members-status" className="sr-only">
              {t('statusFilter')}
            </Label>
            <Select
              items={statusItems}
              value={status}
              onValueChange={(value) => setStatus(value ?? ALL)}
            >
              <SelectTrigger id="members-status" className={TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {statusItems.map((item) => (
                  <SelectItem key={item.value} value={item.value} className="pointer-coarse:py-2.5">
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {failed ? (
          <LoadState
            isError
            onRetry={() => {
              void members.refetch();
              void invitations.refetch();
            }}
          />
        ) : !ready ? (
          <LoadState isError={false} onRetry={reload} />
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm" role="status">
            {filtering ? t('empty') : t('emptyAll')}
          </p>
        ) : (
          <>
            <table className="hidden w-full text-left text-sm md:table">
              <caption className="sr-only">{t('caption')}</caption>
              <thead className="text-muted-foreground border-border border-b">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('name')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('roles')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('statusColumn')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('twoStep')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('lastSignIn')}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">{t('actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td className="py-3 pr-4">{person(row)}</td>
                    <td className="py-3 pr-4">{roleLabels(row)}</td>
                    <td className="py-3 pr-4">{statusPill(row)}</td>
                    <td className="py-3 pr-4">{twoStep(row)}</td>
                    <td className="py-3 pr-4">{lastSignIn(row)}</td>
                    <td className="py-1 text-right">{menu(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="flex flex-col gap-3 md:hidden" aria-label={t('caption')}>
              {rows.map((row) => (
                <li
                  key={row.key}
                  className="border-border flex flex-col gap-3 rounded-lg border p-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    {person(row)}
                    {menu(row)}
                  </div>
                  {roleLabels(row)}
                  <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">{t('statusColumn')}</dt>
                    <dd>{statusPill(row)}</dd>
                    {row.kind === 'member' ? (
                      <>
                        <dt className="text-muted-foreground">{t('twoStep')}</dt>
                        <dd>{twoStep(row)}</dd>
                        <dt className="text-muted-foreground">{t('lastSignIn')}</dt>
                      </>
                    ) : (
                      <dt className="sr-only">{t('lastSignIn')}</dt>
                    )}
                    <dd className={row.kind === 'invite' ? 'col-span-2' : undefined}>
                      {lastSignIn(row)}
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
            {showMembers && members.hasNextPage ? (
              <Button
                variant="outline"
                className={`${BUTTON_CLASS} self-start`}
                disabled={members.isFetchingNextPage}
                onClick={() =>
                  void members.fetchNextPage().then(() => keepFocusInSection('members'))
                }
              >
                {members.isFetchingNextPage ? <Spinner aria-hidden="true" /> : null}
                {members.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
              </Button>
            ) : null}
          </>
        )}
      </div>

      <ChangeRolesDialog
        member={dialog?.kind === 'roles' ? dialog.row : null}
        roles={roles.data ?? []}
        assignableIds={assignableIds}
        onClose={closeDialog}
        onDone={reload}
        finalFocus={finalFocus}
      />
      <DeactivateDialog
        row={dialog?.kind === 'deactivate' ? dialog.row : null}
        onClose={closeDialog}
        onDone={reload}
        finalFocus={finalFocus}
      />
      <ResetTwoFactorDialog
        row={dialog?.kind === 'reset' ? dialog.row : null}
        schoolCode={viewer.schoolCode}
        onClose={closeDialog}
        onDone={reload}
        finalFocus={finalFocus}
      />
      <RevokeInvitationDialog
        row={dialog?.kind === 'revoke' ? dialog.row : null}
        onClose={closeDialog}
        onDone={reload}
        finalFocus={finalFocus}
      />
    </SectionCard>
  );
}
