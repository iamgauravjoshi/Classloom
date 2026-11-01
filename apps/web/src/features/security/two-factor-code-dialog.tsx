'use client';

import { useDisableTwoFactor, useRegenerateRecoveryCodes } from '@classloom/api-client';
import { Button } from '@classloom/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '@classloom/ui/components/ui/dialog';
import { FieldGroup } from '@classloom/ui/components/ui/field';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { cn } from '@classloom/ui/lib/utils';
import { useTranslations } from 'next-intl';
import { type FormEvent, useRef, useState } from 'react';

import { BUTTON_CLASS, LINK_CLASS } from '../auth/auth-ui';
import { CODE_LENGTH, CodeField } from './code-field';
import { RecoveryCodesPanel } from './recovery-codes-panel';
import { securityErrorOf } from './security-errors';
import { useErrorText } from './security-ui';

const NOT_CACHED = { mutation: { gcTime: 0 } } as const;

export type CodeDialogMode = 'disable' | 'regenerate';

interface TwoFactorCodeDialogProps {
  mode: CodeDialogMode;
  email: string;
  triggerLabel: string;
  triggerVariant?: 'outline' | 'destructive';
  onReauth: () => void;
  /** Two-step was turned off, or new codes were saved (Done); also on a 409 (changed elsewhere). */
  onChanged: () => void;
}

/**
 * "Turn off" and "New recovery codes": a dialog asking for an app code (Turn off also takes a
 * recovery code). New codes are then shown in the same dialog.
 */
export function TwoFactorCodeDialog({
  mode,
  email,
  triggerLabel,
  triggerVariant = 'outline',
  onReauth,
  onChanged,
}: TwoFactorCodeDialogProps) {
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && locked) return;
        setOpen(next);
      }}
    >
      <DialogTrigger render={<Button variant={triggerVariant} className={BUTTON_CLASS} />}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent showCloseButton={!locked} className="gap-5 sm:max-w-md">
        <CodeFlow
          mode={mode}
          email={email}
          onReauth={onReauth}
          onLock={() => setLocked(true)}
          onCancel={() => setOpen(false)}
          onFinished={() => {
            setLocked(false);
            setOpen(false);
            onChanged();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

interface CodeFlowProps {
  mode: CodeDialogMode;
  email: string;
  onReauth: () => void;
  onLock: () => void;
  onCancel: () => void;
  onFinished: () => void;
}

function CodeFlow({ mode, email, onReauth, onLock, onCancel, onFinished }: CodeFlowProps) {
  const t = useTranslations('account.security');
  const errorText = useErrorText();
  const disable = useDisableTwoFactor(NOT_CACHED);
  const regenerate = useRegenerateRecoveryCodes(NOT_CACHED);
  const [recovery, setRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [codes, setCodes] = useState<{ codes: string[]; createdAt: Date } | null>(null);
  const submitting = useRef(false);
  const pending = disable.isPending || regenerate.isPending;

  async function submit(candidate: string) {
    if (submitting.current || redirecting) return;
    const entered = recovery ? candidate.trim() : candidate.replace(/\s/g, '');
    if (recovery ? entered === '' : entered.length !== CODE_LENGTH) {
      setError(recovery ? t('errors.recoveryRequired') : t('errors.codeRequired'));
      return;
    }
    submitting.current = true;
    setError(null);
    try {
      if (mode === 'disable') {
        await disable.mutateAsync({
          data: recovery ? { recoveryCode: entered } : { code: entered },
        });
        toast.add({ title: t('twoFactor.turnedOff'), type: 'success' });
        onFinished();
      } else {
        const { recoveryCodes } = await regenerate.mutateAsync({ data: { code: entered } });
        regenerate.reset();
        onLock();
        setCodes({ codes: recoveryCodes, createdAt: new Date() });
      }
    } catch (failure) {
      const outcome = securityErrorOf(failure);
      setValue('');
      if (outcome.kind === 'recentSignIn') {
        setRedirecting(true);
        onReauth();
      } else if (outcome.kind === 'stale') {
        // Already off (or never on) elsewhere: the page refreshes to the real state.
        toast.add({ title: t('errors.stale') });
        onFinished();
      } else {
        setError(errorText(outcome));
      }
    } finally {
      submitting.current = false;
    }
  }

  if (codes) {
    return (
      <RecoveryCodesPanel
        codes={codes.codes}
        email={email}
        createdAt={codes.createdAt}
        onDone={() => {
          toast.add({ title: t('twoFactor.codesCreated'), type: 'success' });
          onFinished();
        }}
      />
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(value);
  }

  const disabling = mode === 'disable';
  const description = disabling
    ? recovery
      ? t('codeDialog.disableRecoveryDescription')
      : t('codeDialog.disableDescription')
    : t('codeDialog.regenerateDescription');

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 pr-8">
        <DialogTitle className="text-h6">
          {disabling ? t('codeDialog.disableTitle') : t('codeDialog.regenerateTitle')}
        </DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </div>
      <FieldGroup>
        <CodeField
          id={recovery ? `${mode}-recovery-code` : `${mode}-code`}
          label={recovery ? t('codeDialog.recoveryLabel') : t('codeDialog.codeLabel')}
          recovery={recovery}
          value={value}
          error={error}
          onChange={(next) => {
            setValue(next);
            if (error) setError(null);
          }}
          onComplete={(complete) => void submit(complete)}
        />
      </FieldGroup>
      {disabling ? (
        <button
          type="button"
          className={cn(LINK_CLASS, 'cursor-pointer self-start text-sm')}
          onClick={() => {
            setRecovery(!recovery);
            setValue('');
            setError(null);
          }}
        >
          {recovery ? t('codeDialog.useApp') : t('codeDialog.useRecovery')}
        </button>
      ) : null}
      {redirecting ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t('redirecting')}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" className={BUTTON_CLASS} onClick={onCancel}>
          {t('codeDialog.cancel')}
        </Button>
        <Button type="submit" className={BUTTON_CLASS} disabled={pending || redirecting}>
          {pending ? <Spinner aria-hidden="true" /> : null}
          {disabling
            ? pending
              ? t('codeDialog.disabling')
              : t('codeDialog.disable')
            : pending
              ? t('codeDialog.regenerating')
              : t('codeDialog.regenerate')}
        </Button>
      </DialogFooter>
    </form>
  );
}
