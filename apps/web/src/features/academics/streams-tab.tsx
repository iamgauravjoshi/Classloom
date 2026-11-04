'use client';

import {
  getListStreamsQueryKey,
  type StreamDto,
  useAddStarterStreams,
  useArchiveStream,
  useCreateStream,
  useDeleteStream,
  useListStreams,
  useRestoreStream,
  useUpdateStream,
} from '@classloom/api-client';
import { createStreamRequestSchema, STARTER_STREAMS } from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button } from '@classloom/ui/components/ui/button';
import { Field, FieldError, FieldLabel } from '@classloom/ui/components/ui/field';
import { Input } from '@classloom/ui/components/ui/input';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';

import { BUTTON_CLASS, CONTROL_CLASS } from '../auth/auth-ui';
import { useLastShown } from '../iam/iam-ui';
import { formatList, isNameTaken, useAcademicsErrorText } from './academics-errors';
import { AddButton, EmptyState, FormDialog, ItemList, ListState, TabIntro } from './academics-ui';

/** Most streams a school can have, counting archived ones (spec section 4). */
const MAX_STREAMS = 20;
const HEADING_ID = 'streams-heading';

type FormInput = { name: string };

/**
 * The Streams tab (spec section 8): the school's streams, active first. While there are none,
 * `classes.manage` holders are offered "Add Science, Commerce and Humanities".
 */
export function StreamsTab({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('academics.streams');
  const errorText = useAcademicsErrorText();
  const queryClient = useQueryClient();
  const { data, isPending, isError, refetch } = useListStreams();
  const starter = useAddStarterStreams();
  const archive = useArchiveStream();
  const restore = useRestoreStream();
  const remove = useDeleteStream();
  const [form, setForm] = useState<{ stream?: StreamDto } | null>(null);
  const [starterError, setStarterError] = useState<string | null>(null);
  const shownForm = useLastShown(form);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: getListStreamsQueryKey() });

  async function addStarter() {
    setStarterError(null);
    try {
      const added = await starter.mutateAsync();
      // The helper is gone once the list refetches; the tab's heading takes focus instead.
      document.getElementById(HEADING_ID)?.focus();
      refresh();
      toast.add({
        title: t('starterAdded', { names: formatList(added.created.map((stream) => stream.name)) }),
        type: 'success',
      });
    } catch (error) {
      setStarterError(errorText(error));
    }
  }

  const streams = data?.streams ?? [];

  return (
    <div className="flex flex-col gap-6">
      <TabIntro
        headingId={HEADING_ID}
        title={t('title')}
        description={t('description')}
        canEdit={canEdit}
      />
      {!data ? (
        <ListState isError={isError && !isPending} onRetry={() => void refetch()} />
      ) : (
        <>
          {canEdit ? (
            <AddButton
              label={t('add')}
              count={streams.length}
              limit={MAX_STREAMS}
              onClick={() => setForm({})}
            />
          ) : null}
          {streams.length === 0 ? (
            <EmptyState title={t('empty')} body={t('emptyBody')}>
              {canEdit ? (
                <Button
                  variant="outline"
                  className={BUTTON_CLASS}
                  disabled={starter.isPending}
                  onClick={() => void addStarter()}
                >
                  {starter.isPending ? <Spinner aria-hidden="true" /> : null}
                  {starter.isPending
                    ? t('starterAdding')
                    : t('starter', { names: formatList(STARTER_STREAMS) })}
                </Button>
              ) : null}
              {starterError ? (
                <Alert variant="destructive">
                  <AlertDescription role="alert">{starterError}</AlertDescription>
                </Alert>
              ) : null}
            </EmptyState>
          ) : (
            <ItemList
              kind="streams"
              items={streams}
              canEdit={canEdit}
              headingId={HEADING_ID}
              onEdit={(stream) => setForm({ stream })}
              archive={(id) => archive.mutateAsync({ id })}
              restore={(id) => restore.mutateAsync({ id })}
              remove={(id) => remove.mutateAsync({ id })}
              onChanged={refresh}
            />
          )}
        </>
      )}

      <FormDialog
        open={form !== null}
        title={
          shownForm?.stream
            ? t('form.editTitle', { name: shownForm.stream.name })
            : t('form.createTitle')
        }
        description={t('form.description')}
        onClose={() => setForm(null)}
      >
        {shownForm ? (
          <StreamForm
            key={shownForm.stream?.id ?? 'new'}
            stream={shownForm.stream}
            onDone={() => {
              refresh();
              setForm(null);
            }}
            onCancel={() => setForm(null)}
          />
        ) : null}
      </FormDialog>
    </div>
  );
}

/** A stream's name: adds a stream, or renames `stream` when given. */
function StreamForm({
  stream,
  onDone,
  onCancel,
}: {
  stream?: StreamDto;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('academics.streams.form');
  const tCommon = useTranslations('academics.common');
  const errorText = useAcademicsErrorText();
  const id = useId();
  const create = useCreateStream();
  const update = useUpdateStream();
  const pending = create.isPending || update.isPending;
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormInput>({
    resolver: zodResolver(createStreamRequestSchema),
    defaultValues: { name: stream?.name ?? '' },
    mode: 'onTouched',
  });
  const error = form.formState.errors.name;

  async function onValid(values: FormInput) {
    setFormError(null);
    try {
      const saved = stream
        ? await update.mutateAsync({ id: stream.id, data: values })
        : await create.mutateAsync({ data: values });
      toast.add({
        title: tCommon(stream ? 'saved' : 'created', { name: saved.name }),
        type: 'success',
      });
      onDone();
    } catch (caught) {
      if (isNameTaken(caught)) {
        form.setError('name', { type: 'taken' }, { shouldFocus: true });
        return;
      }
      setFormError(errorText(caught));
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void form.handleSubmit(onValid)(event)}
      className="flex flex-col gap-6"
    >
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor={`${id}-name`}>{t('name')}</FieldLabel>
        <Input
          id={`${id}-name`}
          className={CONTROL_CLASS}
          autoComplete="off"
          maxLength={40}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-name-error` : undefined}
          {...form.register('name')}
        />
        <FieldError id={`${id}-name-error`}>
          {error ? (error.type === 'taken' ? tCommon('nameTaken') : t('nameError')) : null}
        </FieldError>
      </Field>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription role="alert">{formError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          className={BUTTON_CLASS}
          disabled={pending}
          onClick={onCancel}
        >
          {tCommon('cancel')}
        </Button>
        <Button type="submit" className={BUTTON_CLASS} disabled={pending}>
          {pending ? <Spinner aria-hidden="true" /> : null}
          {pending ? tCommon('saving') : stream ? tCommon('save') : t('create')}
        </Button>
      </div>
    </form>
  );
}
