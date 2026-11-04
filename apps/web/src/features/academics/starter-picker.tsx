'use client';

import {
  getGetStarterSubjectsQueryKey,
  type StarterSubjectsResponseDtoItemsItem,
  useAddStarterSubjects,
  useGetStarterSubjects,
} from '@classloom/api-client';
import { SUBJECT_TYPES } from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Badge } from '@classloom/ui/components/ui/badge';
import { Button } from '@classloom/ui/components/ui/button';
import { Checkbox } from '@classloom/ui/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@classloom/ui/components/ui/dialog';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';

import { BUTTON_CLASS } from '../auth/auth-ui';
import { useAcademicsErrorText } from './academics-errors';
import { ListState } from './academics-ui';

type StarterItem = StarterSubjectsResponseDtoItemsItem;

/**
 * "Add your board's starter subjects" (spec section 5): the board's starter list, every subject
 * ticked except those the school already has, which are shown ticked, disabled and marked
 * "Already added". Adds the ticked ones in one request. `onAdded` runs once they're added; focus
 * then goes to `focusAfterAdd` (the button that opened it may be gone).
 */
export function StarterPicker({
  open,
  onClose,
  onAdded,
  focusAfterAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  focusAfterAdd: string;
}) {
  const t = useTranslations('academics.starter');
  const added = useRef(false);
  const { data, isPending, isError, refetch, dataUpdatedAt } = useGetStarterSubjects({
    query: { enabled: open, staleTime: 0, gcTime: 0 },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-lg"
        finalFocus={() => {
          if (!added.current) return true;
          added.current = false;
          return document.getElementById(focusAfterAdd) ?? true;
        }}
      >
        <div className="flex flex-col gap-2 pr-8">
          <DialogTitle className="text-h6 break-words">{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </div>
        {!data ? (
          <ListState isError={isError && !isPending} onRetry={() => void refetch()} />
        ) : (
          <PickerForm
            key={dataUpdatedAt}
            items={data.items}
            onCancel={onClose}
            onAdded={() => {
              added.current = true;
              onAdded();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PickerForm({
  items,
  onCancel,
  onAdded,
}: {
  items: readonly StarterItem[];
  onCancel: () => void;
  onAdded: () => void;
}) {
  const t = useTranslations('academics.starter');
  const tTypes = useTranslations('academics.subjects.types');
  const tCommon = useTranslations('academics.common');
  const errorText = useAcademicsErrorText();
  const id = useId();
  const queryClient = useQueryClient();
  const add = useAddStarterSubjects();
  const available = items.filter((item) => !item.exists);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set(available.map((item) => item.name)),
  );
  const [error, setError] = useState<string | null>(null);

  const toggle = (name: string, on: boolean) =>
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });

  async function submit() {
    setError(null);
    const picked = available.filter((item) => ticked.has(item.name));
    if (picked.length === 0) {
      setError(t('noneTicked'));
      return;
    }
    try {
      const result = await add.mutateAsync({
        data: {
          items: picked.map((item) => ({
            name: item.name,
            ...(item.code ? { code: item.code } : {}),
            type: item.type,
          })),
        },
      });
      void queryClient.invalidateQueries({ queryKey: getGetStarterSubjectsQueryKey() });
      toast.add({
        title: t('added', { count: result.created.length }),
        description:
          result.skipped.length > 0 ? t('skipped', { count: result.skipped.length }) : undefined,
        type: 'success',
      });
      onAdded();
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  if (available.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <p>{t('allAdded')}</p>
        <div className="flex justify-end">
          <Button type="button" variant="outline" className={BUTTON_CLASS} onClick={onCancel}>
            {tCommon('cancel')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className={BUTTON_CLASS}
          onClick={() => setTicked(new Set(available.map((item) => item.name)))}
        >
          {t('tickAll')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={BUTTON_CLASS}
          onClick={() => setTicked(new Set())}
        >
          {t('untickAll')}
        </Button>
      </div>
      {SUBJECT_TYPES.map((type) => {
        const ofType = items.filter((item) => item.type === type);
        if (ofType.length === 0) return null;
        return (
          <fieldset key={type} className="flex min-w-0 flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">
              {t('listLabel', { type: tTypes(type) })}
            </legend>
            <ul className="divide-y rounded-lg border">
              {ofType.map((item, index) => {
                const boxId = `${id}-${type}-${index}`;
                return (
                  <li key={item.name}>
                    <label
                      htmlFor={boxId}
                      className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 has-disabled:cursor-default"
                    >
                      <Checkbox
                        id={boxId}
                        className="after:-inset-3.5"
                        aria-labelledby={`${boxId}-name`}
                        aria-describedby={
                          [
                            item.code ? `${boxId}-code` : null,
                            item.exists ? `${boxId}-added` : null,
                          ]
                            .filter(Boolean)
                            .join(' ') || undefined
                        }
                        checked={item.exists || ticked.has(item.name)}
                        disabled={item.exists}
                        onCheckedChange={(next) => toggle(item.name, next)}
                      />
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                        <span id={`${boxId}-name`} className="min-w-0 break-words">
                          {item.name}
                        </span>
                        {item.code ? (
                          <span id={`${boxId}-code`} className="text-muted-foreground text-sm">
                            {t('code', { code: item.code })}
                          </span>
                        ) : null}
                        {item.exists ? (
                          <Badge
                            id={`${boxId}-added`}
                            variant="outline"
                            className="border-border text-muted-foreground h-6 px-2.5"
                          >
                            {t('alreadyAdded')}
                          </Badge>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription role="alert">{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          className={BUTTON_CLASS}
          disabled={add.isPending}
          onClick={onCancel}
        >
          {tCommon('cancel')}
        </Button>
        <Button type="submit" className={BUTTON_CLASS} disabled={add.isPending}>
          {add.isPending ? <Spinner aria-hidden="true" /> : null}
          {add.isPending ? t('adding') : t('submit', { count: ticked.size })}
        </Button>
      </div>
    </form>
  );
}
