'use client';

import {
  getGetStarterSubjectsQueryKey,
  getListSubjectsQueryKey,
  type SubjectDto,
  useArchiveSubject,
  useCreateSubject,
  useDeleteSubject,
  useListSubjects,
  useRestoreSubject,
  useUpdateSubject,
} from '@classloom/api-client';
import {
  type CreateSubjectRequest,
  createSubjectRequestSchema,
  SUBJECT_TYPES,
} from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Badge } from '@classloom/ui/components/ui/badge';
import { Button } from '@classloom/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@classloom/ui/components/ui/dropdown-menu';
import { Field, FieldDescription, FieldError, FieldLabel } from '@classloom/ui/components/ui/field';
import { Input } from '@classloom/ui/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@classloom/ui/components/ui/select';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { Switch } from '@classloom/ui/components/ui/switch';
import { toast } from '@classloom/ui/components/ui/toast';
import { cn } from '@classloom/ui/lib/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { IconDots } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { BUTTON_CLASS, CONTROL_CLASS } from '../auth/auth-ui';
import { useLastShown } from '../iam/iam-ui';
import { isNameTaken, useAcademicsErrorText } from './academics-errors';
import {
  AddButton,
  EmptyState,
  FormDialog,
  ItemList,
  ListState,
  TabIntro,
  TRIGGER_CLASS,
} from './academics-ui';
import { StarterPicker } from './starter-picker';

/** Most subjects a school can have, counting archived ones (spec section 4). */
const MAX_SUBJECTS = 200;
const HEADING_ID = 'subjects-heading';

type FormInput = CreateSubjectRequest;
type FieldName = 'name' | 'code' | 'type';

const ERROR_KEYS: Record<FieldName, 'nameError' | 'codeError' | 'type'> = {
  name: 'nameError',
  code: 'codeError',
  type: 'type',
};

/** A subject's type, as a badge beside its name. */
function TypeBadge({ type }: { type: SubjectDto['type'] }) {
  const t = useTranslations('academics.subjects.types');
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-6 px-2.5',
        type === 'SCHOLASTIC'
          ? 'border-primary-strong/40 text-primary-strong'
          : 'border-border text-foreground',
      )}
    >
      {t(type)}
    </Badge>
  );
}

/**
 * The Subjects tab (spec section 8): the school's subjects with their type and code, archived ones
 * shown on request. While there are none, `subjects.manage` holders are offered the board's
 * starter subjects; afterwards the offer is in the "More subject actions" menu.
 */
export function SubjectsTab({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('academics.subjects');
  const queryClient = useQueryClient();
  const switchId = useId();
  const { data, isPending, isError, refetch } = useListSubjects();
  const archive = useArchiveSubject();
  const restore = useRestoreSubject();
  const remove = useDeleteSubject();
  const [form, setForm] = useState<{ subject?: SubjectDto } | null>(null);
  const shownForm = useLastShown(form);
  const [picking, setPicking] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListSubjectsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetStarterSubjectsQueryKey() });
  };
  const subjects = data?.subjects ?? [];
  const archivedCount = subjects.filter((s) => s.status === 'ARCHIVED').length;
  const shown = showArchived ? subjects : subjects.filter((s) => s.status === 'ACTIVE');

  return (
    <div className="flex flex-col gap-6">
      <TabIntro
        headingId={HEADING_ID}
        title={t('title')}
        description={t('description')}
        canEdit={canEdit}
        readOnlyNotice={t('readOnlyNotice')}
      />
      {!data ? (
        <ListState isError={isError && !isPending} onRetry={() => void refetch()} />
      ) : (
        <>
          {canEdit ? (
            <div className="flex flex-wrap items-start gap-2">
              <AddButton
                label={t('add')}
                count={subjects.length}
                limit={MAX_SUBJECTS}
                onClick={() => setForm({})}
              />
              {subjects.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-10 pointer-coarse:size-11"
                        aria-label={t('more')}
                      />
                    }
                  >
                    <IconDots aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-60">
                    <DropdownMenuItem
                      className="pointer-coarse:min-h-11"
                      onClick={() => setPicking(true)}
                    >
                      {t('starter')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          ) : null}
          {archivedCount > 0 ? (
            <div className="flex min-h-11 items-center gap-3">
              <Switch
                id={switchId}
                checked={showArchived}
                onCheckedChange={(next) => setShowArchived(next)}
              />
              <label htmlFor={switchId} className="cursor-pointer text-sm font-medium">
                {t('showArchived', { count: archivedCount })}
              </label>
            </div>
          ) : null}
          {subjects.length === 0 ? (
            <EmptyState title={t('empty')} body={canEdit ? t('emptyBody') : t('emptyReadOnly')}>
              {canEdit ? (
                <Button variant="outline" className={BUTTON_CLASS} onClick={() => setPicking(true)}>
                  {t('starter')}
                </Button>
              ) : null}
            </EmptyState>
          ) : shown.length === 0 ? (
            <p className="text-muted-foreground">{t('allArchived')}</p>
          ) : null}
          {/* Mounted while empty too, so its delete dialog outlives the last subject. */}
          <ItemList
            kind="subjects"
            items={shown}
            canEdit={canEdit}
            headingId={HEADING_ID}
            archiveFocusId={showArchived ? undefined : HEADING_ID}
            badges={(subject) => <TypeBadge type={subject.type} />}
            details={(subject) => (
              <p className="text-muted-foreground text-sm">
                {subject.code ? t('code', { code: subject.code }) : t('noCode')}
              </p>
            )}
            onEdit={(subject) => setForm({ subject })}
            archive={(id) => archive.mutateAsync({ id })}
            restore={(id) => restore.mutateAsync({ id })}
            remove={(id) => remove.mutateAsync({ id })}
            onChanged={refresh}
          />
        </>
      )}

      <StarterPicker
        open={picking}
        onClose={() => setPicking(false)}
        focusAfterAdd={HEADING_ID}
        onAdded={() => {
          refresh();
          setPicking(false);
        }}
      />

      <FormDialog
        open={form !== null}
        title={
          shownForm?.subject
            ? t('form.editTitle', { name: shownForm.subject.name })
            : t('form.createTitle')
        }
        description={t('form.description')}
        onClose={() => setForm(null)}
      >
        {shownForm ? (
          <SubjectForm
            key={shownForm.subject?.id ?? 'new'}
            subject={shownForm.subject}
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

/** A subject's name, code and type: adds a subject, or edits `subject` when given. */
function SubjectForm({
  subject,
  onDone,
  onCancel,
}: {
  subject?: SubjectDto;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('academics.subjects.form');
  const tTypes = useTranslations('academics.subjects.types');
  const tCommon = useTranslations('academics.common');
  const errorText = useAcademicsErrorText();
  const id = useId();
  const create = useCreateSubject();
  const update = useUpdateSubject();
  const pending = create.isPending || update.isPending;
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormInput>({
    resolver: zodResolver(createSubjectRequestSchema),
    defaultValues: {
      name: subject?.name ?? '',
      code: subject?.code ?? '',
      type: subject?.type ?? 'SCHOLASTIC',
    },
    mode: 'onTouched',
  });
  const { errors } = form.formState;
  const typeItems = SUBJECT_TYPES.map((type) => ({ value: type, label: tTypes(type) }));

  async function onValid(values: FormInput) {
    setFormError(null);
    // The schema has trimmed the code, and made a blank one null (which clears it on edit).
    const fields = { name: values.name, code: values.code ?? null, type: values.type };
    try {
      const saved = subject
        ? await update.mutateAsync({ id: subject.id, data: fields })
        : await create.mutateAsync({ data: fields });
      toast.add({
        title: tCommon(subject ? 'saved' : 'created', { name: saved.name }),
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

  const hint = (name: FieldName) => (name === 'code' ? t('codeHint') : null);
  const controlProps = (name: FieldName) => ({
    id: `${id}-${name}`,
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby':
      [hint(name) ? `${id}-${name}-hint` : null, errors[name] ? `${id}-${name}-error` : null]
        .filter(Boolean)
        .join(' ') || undefined,
  });
  const wrap = (name: FieldName, control: ReactNode) => (
    <Field data-invalid={Boolean(errors[name])}>
      <FieldLabel htmlFor={`${id}-${name}`}>{t(name)}</FieldLabel>
      {control}
      {hint(name) ? (
        <FieldDescription id={`${id}-${name}-hint`}>{hint(name)}</FieldDescription>
      ) : null}
      <FieldError id={`${id}-${name}-error`}>
        {errors[name]
          ? errors[name].type === 'taken'
            ? tCommon('nameTaken')
            : t(ERROR_KEYS[name])
          : null}
      </FieldError>
    </Field>
  );

  return (
    <form
      noValidate
      onSubmit={(event) =>
        void form.handleSubmit(onValid, () => setFormError(tCommon('fixErrors')))(event)
      }
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-5">
        {wrap(
          'name',
          <Input
            {...controlProps('name')}
            className={CONTROL_CLASS}
            autoComplete="off"
            maxLength={60}
            {...form.register('name')}
          />,
        )}
        {wrap(
          'code',
          <Input
            {...controlProps('code')}
            className={CONTROL_CLASS}
            autoComplete="off"
            maxLength={10}
            {...form.register('code')}
          />,
        )}
        {wrap(
          'type',
          <Controller
            control={form.control}
            name="type"
            render={({ field }) => (
              <Select
                items={typeItems}
                value={field.value}
                onValueChange={(value) => {
                  if (value) field.onChange(value);
                }}
              >
                <SelectTrigger
                  ref={field.ref}
                  {...controlProps('type')}
                  className={TRIGGER_CLASS}
                  onBlur={field.onBlur}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {typeItems.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="pointer-coarse:py-2.5"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />,
        )}
      </div>
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
          {pending ? tCommon('saving') : subject ? tCommon('save') : t('create')}
        </Button>
      </div>
    </form>
  );
}
