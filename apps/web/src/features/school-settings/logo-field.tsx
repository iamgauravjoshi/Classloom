'use client';

import {
  getGetSchoolProfileQueryKey,
  useRemoveSchoolLogo,
  useUploadSchoolLogo,
} from '@classloom/api-client';
import { Button } from '@classloom/ui/components/ui/button';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { IconPhoto, IconTrash, IconUpload } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type ChangeEvent, useId, useRef, useState } from 'react';

import { BUTTON_CLASS } from '../auth/auth-ui';
import { checkLogoFile, type SchoolErrorKey, schoolErrorMessage } from './school-errors';
import { ConfirmDialog } from './years-list';

const LOCAL_KEYS = { type: 'logoType', size: 'logoSize' } as const;

/**
 * The school's logo: a preview with Upload (or Replace) and Remove, which asks first. The type and
 * the 2 MB size are checked here first; the server still decides, and every refusal it gives has
 * its own message.
 */
export function LogoField({ logoUrl, canEdit }: { logoUrl: string | null; canEdit: boolean }) {
  const t = useTranslations('schoolSettings.logo');
  const tErrors = useTranslations('schoolSettings.errors');
  const queryClient = useQueryClient();
  const upload = useUploadSchoolLogo();
  const remove = useRemoveSchoolLogo();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<SchoolErrorKey | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removeError, setRemoveError] = useState<SchoolErrorKey | null>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const busy = upload.isPending || remove.isPending;

  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetSchoolProfileQueryKey() });

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // The same file can be chosen again after a refusal.
    event.target.value = '';
    if (!file || busy) return;
    const local = checkLogoFile(file);
    if (local) {
      setError(LOCAL_KEYS[local]);
      return;
    }
    setError(null);
    try {
      const profile = await upload.mutateAsync({ data: { file } });
      queryClient.setQueryData(getGetSchoolProfileQueryKey(), profile);
      toast.add({ title: t('uploaded'), type: 'success' });
    } catch (caught) {
      setError(schoolErrorMessage(caught));
    }
  }

  async function onRemove() {
    if (busy) return;
    setError(null);
    setRemoveError(null);
    try {
      await remove.mutateAsync();
      await refresh();
      setConfirmingRemove(false);
      toast.add({ title: t('removed'), type: 'success' });
    } catch (caught) {
      setRemoveError(schoolErrorMessage(caught));
    }
  }

  const describedBy = [hintId, error ? errorId : undefined].filter(Boolean).join(' ');

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="text-h5">
          {t('title')}
        </h2>
        <p id={hintId} className="text-muted-foreground text-sm">
          {t('description')}
        </p>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="bg-muted flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border">
          {logoUrl ? (
            // The API serves the PNG at a versioned URL; next/image has nothing to add.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={t('alt')}
              width={112}
              height={112}
              className="size-full bg-white object-contain p-2"
            />
          ) : (
            <span className="text-muted-foreground flex flex-col items-center gap-1 p-2 text-center text-xs">
              <IconPhoto aria-hidden="true" className="size-8" />
              {t('empty')}
            </span>
          )}
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={t('chooseFile')}
              hidden
              onChange={(event) => void onFile(event)}
            />
            <Button
              type="button"
              variant="outline"
              className={BUTTON_CLASS}
              disabled={busy}
              aria-describedby={describedBy}
              onClick={() => inputRef.current?.click()}
            >
              {upload.isPending ? (
                <Spinner aria-hidden="true" />
              ) : (
                <IconUpload aria-hidden="true" />
              )}
              {upload.isPending ? t('uploading') : logoUrl ? t('replace') : t('upload')}
            </Button>
            {logoUrl ? (
              <Button
                type="button"
                variant="outline"
                className={BUTTON_CLASS}
                disabled={busy}
                onClick={() => {
                  setRemoveError(null);
                  setConfirmingRemove(true);
                }}
              >
                <IconTrash aria-hidden="true" />
                {t('remove')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-danger-strong text-sm">
          {tErrors(error)}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirmingRemove}
        title={t('removeDialog.title')}
        body={t('removeDialog.body')}
        action={t('removeDialog.action')}
        pendingLabel={t('removing')}
        cancelLabel={t('removeDialog.cancel')}
        destructive
        pending={remove.isPending}
        errorText={removeError ? tErrors(removeError) : null}
        onConfirm={() => void onRemove()}
        onClose={() => setConfirmingRemove(false)}
      />
    </section>
  );
}
