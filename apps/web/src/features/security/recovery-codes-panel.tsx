'use client';

import { Button } from '@classloom/ui/components/ui/button';
import { Checkbox } from '@classloom/ui/components/ui/checkbox';
import { DialogDescription, DialogFooter, DialogTitle } from '@classloom/ui/components/ui/dialog';
import { Field, FieldLabel } from '@classloom/ui/components/ui/field';
import { IconCopy, IconDownload } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { BUTTON_CLASS } from '../auth/auth-ui';
import { downloadRecoveryCodes } from './recovery-codes-file';
import { useCopy } from './security-ui';

interface RecoveryCodesPanelProps {
  codes: string[];
  email: string;
  createdAt: Date;
  /** Shown above the title (the setup dialog's "Step 3 of 3"). */
  eyebrow?: string;
  onDone: () => void;
}

/**
 * The 10 new recovery codes, shown once: Download, Copy, and "I've saved these codes", which
 * enables Done. Rendered inside an open dialog.
 */
export function RecoveryCodesPanel({
  codes,
  email,
  createdAt,
  eyebrow,
  onDone,
}: RecoveryCodesPanelProps) {
  const t = useTranslations('account.security.recoveryCodes');
  const copy = useCopy();
  const [saved, setSaved] = useState(false);

  return (
    <>
      <div className="flex flex-col gap-2 pr-8">
        {eyebrow ? <p className="text-muted-foreground text-xs">{eyebrow}</p> : null}
        <DialogTitle className="text-h6">{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </div>
      <ol
        aria-label={t('listLabel')}
        className="bg-muted grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg p-4 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className={BUTTON_CLASS}
          onClick={() =>
            downloadRecoveryCodes(codes, email, createdAt, {
              title: (address, date) => t('file.title', { email: address, date }),
              titleNoEmail: (date) => t('file.titleNoEmail', { date }),
              reminder: t('file.reminder'),
            })
          }
        >
          <IconDownload aria-hidden="true" />
          {t('download')}
        </Button>
        <Button
          variant="outline"
          className={BUTTON_CLASS}
          onClick={() => void copy(codes.join('\n'), t('copied'))}
        >
          <IconCopy aria-hidden="true" />
          {t('copy')}
        </Button>
      </div>
      <Field orientation="horizontal" className="items-center pointer-coarse:min-h-11">
        <Checkbox
          id="recovery-codes-saved"
          checked={saved}
          onCheckedChange={(checked) => setSaved(checked)}
          aria-labelledby="recovery-codes-saved-label"
          className="pointer-coarse:size-6"
        />
        <FieldLabel id="recovery-codes-saved-label" htmlFor="recovery-codes-saved">
          {t('saved')}
        </FieldLabel>
      </Field>
      <DialogFooter>
        <Button className={BUTTON_CLASS} disabled={!saved} onClick={onDone}>
          {t('done')}
        </Button>
      </DialogFooter>
    </>
  );
}
