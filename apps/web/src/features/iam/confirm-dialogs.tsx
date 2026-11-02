'use client';

import {
  useDeactivateMember,
  useResetMemberTwoFactor,
  useRevokeInvitation,
} from '@classloom/api-client';
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
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { reauthPath } from '../account/recent-sign-in';
import { BUTTON_CLASS } from '../auth/auth-ui';
import { iamErrorOf, isStale } from './iam-errors';
import { useIamErrorText, useLastShown } from './iam-ui';
import type { InviteRow, MemberRow } from './members-model';

const NOT_CACHED = { mutation: { gcTime: 0 } } as const;

/** Where focus goes when a dialog closes: the row's menu button, or the list when it is gone. */
export type FinalFocus = () => HTMLElement | null;

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  action: string;
  pendingLabel: string;
  /** Resolves when done (the dialog closes); throws to show the error. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
  finalFocus: FinalFocus;
  /** Shown instead of the buttons' state while the browser leaves for another page. */
  status?: string | null;
  errorText: string | null;
  pending: boolean;
}

function ConfirmDialog({
  open,
  title,
  body,
  action,
  pendingLabel,
  onConfirm,
  onClose,
  finalFocus,
  status,
  errorText,
  pending,
}: ConfirmDialogProps) {
  const t = useTranslations('iam.confirm');
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent
        finalFocus={finalFocus}
        showCloseButton={!pending}
        className="gap-5 sm:max-w-md"
      >
        <div className="flex flex-col gap-2 pr-8">
          <DialogTitle className="text-h6">{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </div>
        {errorText ? (
          <Alert variant="destructive">
            <AlertDescription role="alert">{errorText}</AlertDescription>
          </Alert>
        ) : null}
        {status ? (
          <p role="status" className="text-muted-foreground text-sm">
            {status}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className={BUTTON_CLASS}
            disabled={pending}
            onClick={onClose}
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className={BUTTON_CLASS}
            disabled={pending || Boolean(status)}
            onClick={() => void onConfirm().catch(() => undefined)}
          >
            {pending ? <Spinner aria-hidden="true" /> : null}
            {pending ? pendingLabel : action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RowDialogProps<R> {
  /** Sends the person through the email-code sign-in again, back to this page. */
  onReauth: () => void;
  row: R | null;
  onClose: () => void;
  /** After the change: reload the list. */
  onDone: () => void;
  finalFocus: FinalFocus;
}

/** "Deactivate Anita Sharma?": ends their sessions here and blocks sign-in until reactivated. */
export function DeactivateDialog({
  row,
  onClose,
  onDone,
  onReauth,
  finalFocus,
}: RowDialogProps<MemberRow>) {
  const t = useTranslations('iam.confirm.deactivate');
  const errorText = useIamErrorText();
  const deactivate = useDeactivateMember(NOT_CACHED);
  const [error, setError] = useState<string | null>(null);
  const target = useLastShown(row);

  async function confirm() {
    if (!target) return;
    setError(null);
    try {
      await deactivate.mutateAsync({ membershipId: target.membershipId });
      toast.add({ title: t('done', { name: target.name }), type: 'success' });
      onDone();
      onClose();
    } catch (failure) {
      const outcome = iamErrorOf(failure);
      if (isStale(failure)) onDone();
      if (outcome === 'recentSignIn') onReauth();
      setError(errorText(outcome));
      throw failure;
    }
  }

  return (
    <ConfirmDialog
      open={row !== null}
      title={t('title', { name: target?.name ?? '' })}
      body={t('body')}
      action={t('action')}
      pendingLabel={t('pending')}
      onConfirm={confirm}
      onClose={() => {
        setError(null);
        onClose();
      }}
      finalFocus={finalFocus}
      errorText={error}
      pending={deactivate.isPending}
    />
  );
}

/**
 * "Reset two-step for …?" Needs the admin's own recent sign-in: when the API says so, the browser
 * goes through the email-code sign-in and comes back to this page.
 */
export function ResetTwoFactorDialog({
  row,
  schoolCode,
  onClose,
  onDone,
  finalFocus,
}: RowDialogProps<MemberRow> & { schoolCode: string }) {
  const t = useTranslations('iam.confirm.reset');
  const locale = useLocale();
  const errorText = useIamErrorText();
  const reset = useResetMemberTwoFactor(NOT_CACHED);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const target = useLastShown(row);

  async function confirm() {
    if (!target) return;
    setError(null);
    try {
      await reset.mutateAsync({ membershipId: target.membershipId });
      toast.add({ title: t('done', { name: target.name }), type: 'success' });
      onDone();
      onClose();
    } catch (failure) {
      const outcome = iamErrorOf(failure);
      if (outcome === 'recentSignIn') {
        setRedirecting(true);
        window.location.assign(reauthPath(locale, schoolCode, `/${locale}/users-roles`));
      } else {
        if (isStale(failure)) onDone();
        setError(errorText(outcome));
      }
      throw failure;
    }
  }

  return (
    <ConfirmDialog
      open={row !== null}
      title={t('title', { name: target?.name ?? '' })}
      body={t('body')}
      action={t('action')}
      pendingLabel={t('pending')}
      onConfirm={confirm}
      onClose={() => {
        setError(null);
        setRedirecting(false);
        onClose();
      }}
      finalFocus={finalFocus}
      status={redirecting ? t('redirecting') : null}
      errorText={error}
      pending={reset.isPending}
    />
  );
}

/** "Revoke the invitation for …?": the emailed link stops working. */
export function RevokeInvitationDialog({
  row,
  onClose,
  onDone,
  onReauth,
  finalFocus,
}: RowDialogProps<InviteRow>) {
  const t = useTranslations('iam.confirm.revoke');
  const errorText = useIamErrorText();
  const revoke = useRevokeInvitation(NOT_CACHED);
  const [error, setError] = useState<string | null>(null);
  const target = useLastShown(row);

  async function confirm() {
    if (!target) return;
    setError(null);
    try {
      await revoke.mutateAsync({ invitationId: target.invitationId });
      toast.add({ title: t('done', { name: target.name }), type: 'success' });
      onDone();
      onClose();
    } catch (failure) {
      const outcome = iamErrorOf(failure);
      if (isStale(failure)) onDone();
      if (outcome === 'recentSignIn') onReauth();
      setError(errorText(outcome));
      throw failure;
    }
  }

  return (
    <ConfirmDialog
      open={row !== null}
      title={t('title', { name: target?.name ?? '' })}
      body={t('body')}
      action={t('action')}
      pendingLabel={t('pending')}
      onConfirm={confirm}
      onClose={() => {
        setError(null);
        onClose();
      }}
      finalFocus={finalFocus}
      errorText={error}
      pending={revoke.isPending}
    />
  );
}
