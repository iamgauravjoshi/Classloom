'use client';

import {
  getListHousesQueryKey,
  type HouseDto,
  useArchiveHouse,
  useCreateHouse,
  useDeleteHouse,
  useListHouses,
  useRestoreHouse,
  useUpdateHouse,
} from '@classloom/api-client';
import {
  type CreateHouseRequest,
  createHouseRequestSchema,
  HOUSE_COLOURS,
} from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button } from '@classloom/ui/components/ui/button';
import { Field, FieldError, FieldLabel } from '@classloom/ui/components/ui/field';
import { Input } from '@classloom/ui/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@classloom/ui/components/ui/select';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { cn } from '@classloom/ui/lib/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
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
import { HOUSE_COLOUR_CLASS, HouseSwatch } from './house-colours';

/** Most houses a school can have, counting archived ones (spec section 4). */
const MAX_HOUSES = 20;
const HEADING_ID = 'houses-heading';

type FormValues = CreateHouseRequest;

/** The Houses tab (spec section 8): the school's houses, active first, each with its colour. */
export function HousesTab({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('academics.houses');
  const queryClient = useQueryClient();
  const { data, isPending, isError, refetch } = useListHouses();
  const archive = useArchiveHouse();
  const restore = useRestoreHouse();
  const remove = useDeleteHouse();
  const [form, setForm] = useState<{ house?: HouseDto } | null>(null);
  const shownForm = useLastShown(form);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: getListHousesQueryKey() });
  const houses = data?.houses ?? [];

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
              count={houses.length}
              limit={MAX_HOUSES}
              onClick={() => setForm({})}
            />
          ) : null}
          {houses.length === 0 ? (
            <EmptyState title={t('empty')} body={t('emptyBody')} />
          ) : (
            <ItemList
              kind="houses"
              items={houses}
              canEdit={canEdit}
              headingId={HEADING_ID}
              details={(house) => (
                <div>
                  <HouseSwatch colour={house.colour} />
                </div>
              )}
              onEdit={(house) => setForm({ house })}
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
          shownForm?.house
            ? t('form.editTitle', { name: shownForm.house.name })
            : t('form.createTitle')
        }
        description={t('form.description')}
        onClose={() => setForm(null)}
      >
        {shownForm ? (
          <HouseForm
            key={shownForm.house?.id ?? 'new'}
            house={shownForm.house}
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

/** A house's name and colour: adds a house, or edits `house` when given. */
function HouseForm({
  house,
  onDone,
  onCancel,
}: {
  house?: HouseDto;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('academics.houses.form');
  const tColours = useTranslations('academics.houses.colours');
  const tCommon = useTranslations('academics.common');
  const errorText = useAcademicsErrorText();
  const id = useId();
  const create = useCreateHouse();
  const update = useUpdateHouse();
  const pending = create.isPending || update.isPending;
  const [formError, setFormError] = useState<string | null>(null);
  // A new house has no colour until one is chosen; the schema then asks for one.
  const form = useForm<FormValues>({
    resolver: zodResolver(createHouseRequestSchema),
    defaultValues: { name: house?.name ?? '', colour: house?.colour },
    mode: 'onTouched',
  });
  const { errors } = form.formState;
  const items = HOUSE_COLOURS.map((colour) => ({ value: colour, label: tColours(colour) }));

  async function onValid(body: FormValues) {
    setFormError(null);
    try {
      const saved = house
        ? await update.mutateAsync({ id: house.id, data: body })
        : await create.mutateAsync({ data: body });
      toast.add({
        title: tCommon(house ? 'saved' : 'created', { name: saved.name }),
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

  const describedBy = (name: 'name' | 'colour') =>
    errors[name] ? `${id}-${name}-error` : undefined;

  return (
    <form
      noValidate
      onSubmit={(event) =>
        void form.handleSubmit(onValid, () => setFormError(tCommon('fixErrors')))(event)
      }
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-5">
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor={`${id}-name`}>{t('name')}</FieldLabel>
          <Input
            id={`${id}-name`}
            className={CONTROL_CLASS}
            autoComplete="off"
            maxLength={40}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={describedBy('name')}
            {...form.register('name')}
          />
          <FieldError id={`${id}-name-error`}>
            {errors.name
              ? errors.name.type === 'taken'
                ? tCommon('nameTaken')
                : t('nameError')
              : null}
          </FieldError>
        </Field>
        <Field data-invalid={Boolean(errors.colour)}>
          <FieldLabel htmlFor={`${id}-colour`}>{t('colour')}</FieldLabel>
          <Controller
            control={form.control}
            name="colour"
            render={({ field }) => (
              <Select
                items={items}
                value={field.value ?? null}
                onValueChange={(value) => {
                  if (value) field.onChange(value);
                }}
              >
                <SelectTrigger
                  ref={field.ref}
                  id={`${id}-colour`}
                  aria-invalid={Boolean(errors.colour)}
                  aria-describedby={describedBy('colour')}
                  className={TRIGGER_CLASS}
                  onBlur={field.onBlur}
                >
                  <SelectValue placeholder={t('chooseColour')} />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {items.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="pointer-coarse:py-2.5"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'size-3 shrink-0 rounded-full',
                          HOUSE_COLOUR_CLASS[option.value],
                        )}
                      >
                        <span className="block size-full rounded-full bg-current" />
                      </span>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError id={`${id}-colour-error`}>
            {errors.colour ? t('colourError') : null}
          </FieldError>
        </Field>
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
          {pending ? tCommon('saving') : house ? tCommon('save') : t('create')}
        </Button>
      </div>
    </form>
  );
}
