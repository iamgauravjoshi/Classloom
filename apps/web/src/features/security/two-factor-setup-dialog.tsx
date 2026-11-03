'use client';

import { Button } from '@classloom/ui/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@classloom/ui/components/ui/dialog';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { BUTTON_CLASS } from '../auth/auth-ui';
import { TwoFactorSetupFlow } from './two-factor-setup-flow';

interface TwoFactorSetupDialogProps {
  email: string;
  /** A 403 asked for a recent sign-in: the page sends the person to sign in again. */
  onReauth: () => void;
  /** Two-step is on and the codes were saved (Done). */
  onEnabled: () => void;
  /** A 409: two-step was already on (turned on elsewhere). The dialog has closed. */
  onAlreadyOn: () => void;
}

/** "Turn on" and its three-step dialog: scan the QR code, enter a code, save the recovery codes. */
export function TwoFactorSetupDialog({
  email,
  onReauth,
  onEnabled,
  onAlreadyOn,
}: TwoFactorSetupDialogProps) {
  const t = useTranslations('account.security');
  const [open, setOpen] = useState(false);
  // While the recovery codes show, the dialog only closes through Done.
  const [locked, setLocked] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && locked) return;
        setOpen(next);
      }}
    >
      <DialogTrigger render={<Button className={BUTTON_CLASS} />}>
        {t('twoFactor.turnOn')}
      </DialogTrigger>
      <DialogContent showCloseButton={!locked} className="gap-5 sm:max-w-md">
        <TwoFactorSetupFlow
          email={email}
          surface="dialog"
          onReauth={onReauth}
          onLock={() => setLocked(true)}
          onCancel={() => setOpen(false)}
          onAlreadyOn={() => {
            setLocked(false);
            setOpen(false);
            onAlreadyOn();
          }}
          onDone={() => {
            setLocked(false);
            setOpen(false);
            onEnabled();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
