'use client';

import { useSetMemberRoles } from '@classloom/api-client';
import type { Role } from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button } from '@classloom/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@classloom/ui/components/ui/dialog';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { BUTTON_CLASS } from '../auth/auth-ui';
import type { FinalFocus } from './confirm-dialogs';
import { iamErrorOf } from './iam-errors';
import { RoleChecklist, useIamErrorText, useLastShown } from './iam-ui';
import type { MemberRow } from './members-model';

const NOT_CACHED = { mutation: { gcTime: 0 } } as const;

interface ChangeRolesDialogProps {
  member: MemberRow | null;
  /** Every role of the school. */
  roles: readonly Role[];
  /** The ids of the roles the viewer may give. */
  assignableIds: ReadonlySet<string>;
  onClose: () => void;
  onDone: () => void;
  finalFocus: FinalFocus;
}

/** "Change roles": the member's roles replaced by the ticked ones (at least one). */
export function ChangeRolesDialog({
  member,
  roles,
  assignableIds,
  onClose,
  onDone,
  finalFocus,
}: ChangeRolesDialogProps) {
  const target = useLastShown(member);
  return (
    <Dialog open={member !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent finalFocus={finalFocus} className="gap-5 sm:max-w-md">
        {target ? (
          <RolesForm
            key={target.membershipId}
            member={target}
            roles={roles}
            assignableIds={assignableIds}
            onClose={onClose}
            onDone={onDone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RolesForm({
  member,
  roles,
  assignableIds,
  onClose,
  onDone,
}: Omit<ChangeRolesDialogProps, 'finalFocus' | 'member'> & { member: MemberRow }) {
  const t = useTranslations('iam.changeRoles');
  const errorText = useIamErrorText();
  const setRoles = useSetMemberRoles(NOT_CACHED);
  const heldIds = new Set(member.roles.map((role) => role.id));
  const [selected, setSelected] = useState<ReadonlySet<string>>(heldIds);
  const [error, setError] = useState<string | null>(null);
  const [required, setRequired] = useState<string | null>(null);

  // What the viewer may offer, plus what the person holds that the viewer cannot change.
  const locked = new Set([...heldIds].filter((id) => !assignableIds.has(id)));
  const offered = roles.filter((role) => assignableIds.has(role.id) || heldIds.has(role.id));

  async function save() {
    if (selected.size === 0) {
      setRequired(t('required'));
      return;
    }
    setError(null);
    setRequired(null);
    try {
      await setRoles.mutateAsync({
        membershipId: member.membershipId,
        data: { roleIds: [...selected] },
      });
      toast.add({ title: t('saved', { name: member.name }), type: 'success' });
      onDone();
      onClose();
    } catch (failure) {
      setError(errorText(iamErrorOf(failure)));
    }
  }

  const pending = setRoles.isPending;

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-col gap-2 pr-8">
        <DialogTitle className="text-h6">{t('title', { name: member.name })}</DialogTitle>
        <DialogDescription>{t('description', { name: member.name })}</DialogDescription>
      </div>
      <RoleChecklist
        legend={t('roles')}
        roles={offered}
        selected={selected}
        locked={locked}
        lockedNote={t('locked')}
        error={required}
        disabled={pending}
        onToggle={(id, checked) => {
          setRequired(null);
          setSelected((current) => {
            const next = new Set(current);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
          });
        }}
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription role="alert">{error}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" className={BUTTON_CLASS} onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button type="submit" className={BUTTON_CLASS} disabled={pending}>
          {pending ? <Spinner aria-hidden="true" /> : null}
          {pending ? t('submitting') : t('submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
