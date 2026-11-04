'use client';

import {
  type CampusDto,
  getGetOnboardingQueryKey,
  getListCampusesQueryKey,
  useCreateCampus,
  useUpdateCampus,
} from '@classloom/api-client';
import { type Campus, createCampusRequestSchema, INDIAN_STATES } from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button } from '@classloom/ui/components/ui/button';
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
import { toast } from '@classloom/ui/components/ui/toast';
import { cn } from '@classloom/ui/lib/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ComponentProps, type ReactNode, useEffect, useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { BUTTON_CLASS, CONTROL_CLASS } from '../auth/auth-ui';
import { schoolErrorMessage, schoolFieldErrors } from './school-errors';

const TRIGGER_CLASS = cn(
  'w-full',
  CONTROL_CLASS,
  'data-[size=default]:h-10 pointer-coarse:data-[size=default]:h-11',
);

/**
 * The create schema, but a blank city and no state mean "the school's" (left out of a create).
 * An edit can't clear the city, so it is required there.
 */
const formSchema = (editing: boolean) =>
  createCampusRequestSchema
    .extend({
      // The district's rule (optional text up to 60, blank as null) fits the city here.
      city: createCampusRequestSchema.shape.district,
      state: createCampusRequestSchema.shape.state.nullable(),
    })
    .superRefine((v, ctx) => {
      if (editing && !v.city) {
        ctx.addIssue({ code: 'custom', path: ['city'], message: 'Enter the city' });
      }
      if (editing && !v.state) {
        ctx.addIssue({ code: 'custom', path: ['state'], message: 'Choose a state' });
      }
    });

type FormSchema = ReturnType<typeof formSchema>;
/** What the form holds before parsing, and what a valid form parses to (zod's own input and output). */
type FormInput = FormSchema['_zod']['input'];
type FormOutput = FormSchema['_zod']['output'];
type FieldName = Extract<keyof FormInput, string>;

/** The `campuses.form` message for a refused field. */
const ERROR_KEYS: Record<FieldName, string> = {
  name: 'nameError',
  addressLine1: 'addressLineError',
  addressLine2: 'addressLineError',
  city: 'cityError',
  district: 'districtError',
  state: 'stateError',
  pinCode: 'pinCodeError',
  phone: 'phoneError',
  email: 'emailError',
};

const isFieldName = (path: string): path is FieldName => path in ERROR_KEYS;

function toFormValues(campus: Campus | undefined): FormInput {
  const text = (value: string | null | undefined) => value ?? '';
  return {
    name: text(campus?.name),
    addressLine1: text(campus?.addressLine1),
    addressLine2: text(campus?.addressLine2),
    city: text(campus?.city),
    district: text(campus?.district),
    state: campus?.state ?? null,
    pinCode: text(campus?.pinCode),
    phone: text(campus?.phone),
    email: text(campus?.email),
  };
}

/**
 * A campus's name, address and contact (spec §7). It adds a campus, or edits `campus` when given.
 * On a new campus a blank city and state default to the school's. The setup wizard embeds it.
 */
export function CampusForm({
  campus,
  onSaved,
  onCancel,
  onDirtyChange,
  renderActions,
  formId,
}: {
  campus?: Campus;
  onSaved: (campus: CampusDto) => void;
  onCancel?: () => void;
  /** Hears whether the form has unsaved edits (the wizard's leave guard). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Replaces the Cancel and save buttons (the wizard's step actions); a submit button saves. */
  renderActions?: (state: { pending: boolean }) => ReactNode;
  /** The form element's id, for a submit button placed outside it (`form=`). */
  formId?: string;
}) {
  const t = useTranslations('schoolSettings.campuses.form');
  const tErrors = useTranslations('schoolSettings.errors');
  const id = useId();
  const queryClient = useQueryClient();
  const router = useRouter();
  const create = useCreateCampus();
  const update = useUpdateCampus();
  const pending = create.isPending || update.isPending;
  const editing = Boolean(campus);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema(editing)),
    defaultValues: toFormValues(campus),
    mode: 'onTouched',
  });
  const { errors, isDirty } = form.formState;
  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);

  const fieldId = (name: FieldName) => `${id}-${name}`;
  const hasHint = (name: FieldName) => name === 'city' && !editing;
  const controlProps = (name: FieldName) => ({
    id: fieldId(name),
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby':
      [
        hasHint(name) ? `${fieldId(name)}-hint` : null,
        errors[name] ? `${fieldId(name)}-error` : null,
      ]
        .filter(Boolean)
        .join(' ') || undefined,
  });

  async function onValid(values: FormOutput) {
    setFormError(null);
    const { city, state, ...rest } = values;
    const body = {
      ...rest,
      ...(city ? { city } : {}),
      ...(state ? { state } : {}),
    };
    try {
      const saved = campus
        ? await update.mutateAsync({ id: campus.id, data: body })
        : await create.mutateAsync({ data: body });
      void queryClient.invalidateQueries({ queryKey: getListCampusesQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetOnboardingQueryKey() });
      router.refresh();
      toast.add({
        title: campus ? t('saved') : t('created', { name: saved.name }),
        type: 'success',
      });
      form.reset(toFormValues(saved));
      onSaved(saved);
    } catch (error) {
      const fields = schoolFieldErrors(error).filter(isFieldName);
      if (fields.length > 0) {
        fields.forEach((name, index) =>
          form.setError(name, { type: 'server' }, { shouldFocus: index === 0 }),
        );
        setFormError(t('fixErrors'));
        return;
      }
      setFormError(tErrors(schoolErrorMessage(error)));
    }
  }

  const wrap = (name: FieldName, control: ReactNode, wide = false) => (
    <Field data-invalid={Boolean(errors[name])} className={wide ? 'sm:col-span-2' : undefined}>
      <FieldLabel htmlFor={fieldId(name)}>{t(name)}</FieldLabel>
      {control}
      {hasHint(name) ? (
        <FieldDescription id={`${fieldId(name)}-hint`}>{t(`${name}Hint`)}</FieldDescription>
      ) : null}
      <FieldError id={`${fieldId(name)}-error`}>
        {errors[name] ? t(ERROR_KEYS[name]) : null}
      </FieldError>
    </Field>
  );

  const text = (
    name: Exclude<FieldName, 'state'>,
    extra: { wide?: boolean } & ComponentProps<typeof Input> = {},
  ) => {
    const { wide, ...inputProps } = extra;
    return wrap(
      name,
      <Input
        {...controlProps(name)}
        className={CONTROL_CLASS}
        {...inputProps}
        {...form.register(name)}
      />,
      wide,
    );
  };

  const stateItems = [
    ...(editing ? [] : [{ value: null, label: t('stateSame') }]),
    ...INDIAN_STATES.map((state) => ({ value: state.code, label: state.name })),
  ];

  return (
    <form
      id={formId}
      noValidate
      onSubmit={(event) =>
        void form.handleSubmit(onValid, () => setFormError(t('fixErrors')))(event)
      }
      className="flex flex-col gap-6"
    >
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {text('name', { wide: true, autoComplete: 'off', maxLength: 80 })}
        {text('addressLine1', { wide: true, autoComplete: 'address-line1' })}
        {text('addressLine2', { wide: true, autoComplete: 'address-line2' })}
        {text('city', { autoComplete: 'address-level2' })}
        {text('district')}
        {wrap(
          'state',
          <Controller
            control={form.control}
            name="state"
            render={({ field }) => (
              <Select
                items={stateItems}
                value={field.value ?? null}
                onValueChange={(value) => field.onChange(value ?? null)}
              >
                <SelectTrigger
                  ref={field.ref}
                  {...controlProps('state')}
                  className={TRIGGER_CLASS}
                  onBlur={field.onBlur}
                >
                  <SelectValue placeholder={t('stateSame')} />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {stateItems.map((option) => (
                    <SelectItem
                      key={option.value ?? ''}
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
        {text('pinCode', { inputMode: 'numeric', autoComplete: 'postal-code', maxLength: 6 })}
        {text('phone', { type: 'tel', inputMode: 'tel', autoComplete: 'tel-national' })}
        {text('email', { type: 'email', autoComplete: 'email' })}
      </div>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription role="alert">{formError}</AlertDescription>
        </Alert>
      ) : null}
      {renderActions ? (
        renderActions({ pending })
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          {onCancel ? (
            <Button
              type="button"
              variant="outline"
              className={BUTTON_CLASS}
              disabled={pending}
              onClick={onCancel}
            >
              {t('cancel')}
            </Button>
          ) : null}
          <Button type="submit" className={BUTTON_CLASS} disabled={pending}>
            {pending ? <Spinner aria-hidden="true" /> : null}
            {pending ? t('saving') : editing ? t('save') : t('create')}
          </Button>
        </div>
      )}
    </form>
  );
}
