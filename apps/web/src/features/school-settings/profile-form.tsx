'use client';

import { getGetSchoolProfileQueryKey, useUpdateSchoolProfile } from '@classloom/api-client';
import {
  BOARDS,
  CLASS_LEVELS,
  INDIAN_STATES,
  MEDIUM_SUGGESTIONS,
  RESIDENTIAL,
  SCHOOL_TYPES,
  type SchoolProfile,
  type UpdateSchoolProfileInput,
  type UpdateSchoolProfileRequest,
  updateSchoolProfileRequestSchema,
} from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button } from '@classloom/ui/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@classloom/ui/components/ui/field';
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
import { type ComponentProps, type ReactNode, useId, useMemo, useState } from 'react';
import { Controller, type FieldPath, useForm } from 'react-hook-form';

import { BUTTON_CLASS, CONTROL_CLASS } from '../auth/auth-ui';
import { schoolErrorMessage, schoolFieldErrors } from './school-errors';

type FormValues = UpdateSchoolProfileInput;
type FieldName = FieldPath<FormValues>;

const TRIGGER_CLASS = cn(
  'w-full',
  CONTROL_CLASS,
  'data-[size=default]:h-10 pointer-coarse:data-[size=default]:h-11',
);

/** The `schoolSettings.profile.fields` message for a field the schema or the API refused. */
const ERROR_KEYS: Record<FieldName, string> = {
  name: 'nameError',
  board: 'boardError',
  legalName: 'legalNameError',
  shortName: 'shortNameError',
  establishedYear: 'establishedYearError',
  udiseCode: 'udiseCodeError',
  affiliationNumber: 'affiliationNumberError',
  schoolType: 'chooseError',
  residential: 'chooseError',
  medium: 'mediumError',
  lowestClass: 'chooseError',
  highestClass: 'highestClassError',
  phone: 'phoneError',
  email: 'emailError',
  website: 'websiteError',
  addressLine1: 'addressLineError',
  addressLine2: 'addressLineError',
  city: 'placeError',
  district: 'placeError',
  state: 'stateError',
  pinCode: 'pinCodeError',
};

const isFieldName = (path: string): path is FieldName => path in ERROR_KEYS;

/** The form's starting values: the profile with every missing text as ''. */
function toFormValues(profile: SchoolProfile): FormValues {
  const text = (value: string | null) => value ?? '';
  return {
    name: profile.name,
    board: profile.board,
    legalName: text(profile.legalName),
    shortName: text(profile.shortName),
    establishedYear: profile.establishedYear,
    udiseCode: text(profile.udiseCode),
    affiliationNumber: text(profile.affiliationNumber),
    schoolType: profile.schoolType ?? '',
    residential: profile.residential ?? '',
    medium: text(profile.medium),
    lowestClass: profile.lowestClass ?? '',
    highestClass: profile.highestClass ?? '',
    phone: text(profile.phone),
    email: text(profile.email),
    website: text(profile.website),
    addressLine1: text(profile.addressLine1),
    addressLine2: text(profile.addressLine2),
    city: text(profile.city),
    district: text(profile.district),
    state: profile.state,
    pinCode: text(profile.pinCode),
  };
}

function FormField({
  id,
  label,
  hint,
  error,
  wide,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <Field data-invalid={Boolean(error)} className={wide ? 'sm:col-span-2' : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {hint ? <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription> : null}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}

interface Option {
  value: string | null;
  label: string;
}

/**
 * The school profile (spec §4). With `canEdit` it is a form that saves with `PUT /school/profile`;
 * without it the same fields are shown read-only. The setup wizard embeds it and hears `onSaved`.
 */
export function ProfileForm({
  profile,
  canEdit,
  onSaved,
}: {
  profile: SchoolProfile;
  canEdit: boolean;
  onSaved?: () => void;
}) {
  const t = useTranslations('schoolSettings.profile');
  const tBoards = useTranslations('registration.boards');
  const options = useMemo(() => {
    const notSet: Option = { value: null, label: t('notSet') };
    return {
      boards: BOARDS.map((value) => ({ value, label: tBoards(value) })),
      states: INDIAN_STATES.map((state) => ({ value: state.code, label: state.name })),
      schoolTypes: [
        notSet,
        ...SCHOOL_TYPES.map((v) => ({ value: v, label: t(`schoolTypes.${v}`) })),
      ],
      residential: [
        notSet,
        ...RESIDENTIAL.map((v) => ({ value: v, label: t(`residentialOptions.${v}`) })),
      ],
      classes: [notSet, ...CLASS_LEVELS.map((v) => ({ value: v, label: t(`classLevels.${v}`) }))],
    };
  }, [t, tBoards]);

  if (!canEdit) return <ProfileView profile={profile} options={options} />;
  return <ProfileEditor profile={profile} options={options} onSaved={onSaved} />;
}

type Options = {
  boards: Option[];
  states: Option[];
  schoolTypes: Option[];
  residential: Option[];
  classes: Option[];
};

const labelOf = (list: Option[], value: string | null) =>
  value === null ? null : (list.find((option) => option.value === value)?.label ?? value);

function ProfileView({ profile, options }: { profile: SchoolProfile; options: Options }) {
  const t = useTranslations('schoolSettings.profile');
  const sections: { key: string; rows: [string, string | number | null][] }[] = [
    {
      key: 'identity',
      rows: [
        ['name', profile.name],
        ['code', profile.code],
        ['legalName', profile.legalName],
        ['shortName', profile.shortName],
        ['board', labelOf(options.boards, profile.board)],
        ['establishedYear', profile.establishedYear],
        ['udiseCode', profile.udiseCode],
        ['affiliationNumber', profile.affiliationNumber],
      ],
    },
    {
      key: 'about',
      rows: [
        ['schoolType', labelOf(options.schoolTypes, profile.schoolType)],
        ['residential', labelOf(options.residential, profile.residential)],
        ['medium', profile.medium],
        ['lowestClass', labelOf(options.classes, profile.lowestClass)],
        ['highestClass', labelOf(options.classes, profile.highestClass)],
      ],
    },
    {
      key: 'contact',
      rows: [
        ['phone', profile.phone],
        ['email', profile.email],
        ['website', profile.website],
      ],
    },
    {
      key: 'address',
      rows: [
        ['addressLine1', profile.addressLine1],
        ['addressLine2', profile.addressLine2],
        ['city', profile.city],
        ['district', profile.district],
        ['state', labelOf(options.states, profile.state)],
        ['pinCode', profile.pinCode],
      ],
    },
  ];
  return (
    <div className="flex flex-col gap-8">
      <Alert>
        <AlertDescription>{t('readOnlyNotice')}</AlertDescription>
      </Alert>
      {sections.map((section) => (
        <section key={section.key} className="flex flex-col gap-3">
          <h2 className="text-h5">{t(`sections.${section.key}`)}</h2>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {section.rows.map(([field, value]) => (
              <div key={field} className="flex min-w-0 flex-col gap-1">
                <dt className="text-muted-foreground text-sm">{t(`fields.${field}`)}</dt>
                <dd className="break-words">
                  {value === null || value === '' ? (
                    <span className="text-muted-foreground">{t('notSet')}</span>
                  ) : (
                    value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function ProfileEditor({
  profile,
  options,
  onSaved,
}: {
  profile: SchoolProfile;
  options: Options;
  onSaved?: () => void;
}) {
  const t = useTranslations('schoolSettings.profile');
  const tErrors = useTranslations('schoolSettings.errors');
  const queryClient = useQueryClient();
  const update = useUpdateSchoolProfile();
  const id = useId();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormValues, unknown, UpdateSchoolProfileRequest>({
    resolver: zodResolver(updateSchoolProfileRequestSchema),
    defaultValues: toFormValues(profile),
    mode: 'onTouched',
  });
  const { errors } = form.formState;
  const currentYear = new Date().getFullYear();

  const fieldId = (name: FieldName) => `${id}-${name}`;
  const errorText = (name: FieldName) =>
    errors[name]
      ? t(`fields.${ERROR_KEYS[name]}`, name === 'establishedYear' ? { year: currentYear } : {})
      : undefined;
  const describedBy = (name: FieldName, hint?: boolean) =>
    [
      hint ? `${fieldId(name)}-hint` : undefined,
      errors[name] ? `${fieldId(name)}-error` : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  /** The props every control shares: its id, invalid state and descriptions. */
  const controlProps = (name: FieldName, hint?: boolean) => ({
    id: fieldId(name),
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': describedBy(name, hint),
  });

  async function onValid(values: UpdateSchoolProfileRequest) {
    setFormError(null);
    try {
      const saved = await update.mutateAsync({ data: values });
      queryClient.setQueryData(getGetSchoolProfileQueryKey(), saved);
      form.reset(toFormValues(saved));
      toast.add({ title: t('saved'), type: 'success' });
      onSaved?.();
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

  /** The label, hint and error around a control. */
  const wrap = (
    name: FieldName,
    children: ReactNode,
    opts: { hint?: boolean; wide?: boolean } = {},
  ) => (
    <FormField
      id={fieldId(name)}
      label={t(`fields.${name}`)}
      hint={opts.hint ? t(`fields.${name}Hint`) : undefined}
      error={errorText(name)}
      wide={opts.wide}
    >
      {children}
    </FormField>
  );

  const text = (
    name: FieldName,
    extra: { hint?: boolean; wide?: boolean } & ComponentProps<typeof Input> = {},
  ) => {
    const { hint, wide, ...inputProps } = extra;
    return wrap(
      name,
      <Input
        {...controlProps(name, hint)}
        className={CONTROL_CLASS}
        {...inputProps}
        {...form.register(name)}
      />,
      { hint, wide },
    );
  };

  const select = (name: FieldName, list: Option[], required = false) =>
    wrap(
      name,
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Select
            items={list}
            value={(field.value as string | null | undefined) || null}
            onValueChange={(value) => field.onChange(value ?? '')}
          >
            <SelectTrigger
              ref={field.ref}
              {...controlProps(name)}
              className={TRIGGER_CLASS}
              onBlur={field.onBlur}
            >
              <SelectValue placeholder={required ? t('choose') : t('notSet')} />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {list.map((option) => (
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
    );

  const section = (key: string, children: ReactNode) => (
    <FieldSet className="gap-4" aria-describedby={`${id}-${key}-description`}>
      <FieldLegend className="text-h5">{t(`sections.${key}`)}</FieldLegend>
      <FieldDescription id={`${id}-${key}-description`} className="-mt-3">
        {t(`sections.${key}Description`)}
      </FieldDescription>
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">{children}</div>
    </FieldSet>
  );

  const mediumList = `${id}-medium-suggestions`;

  return (
    <form
      noValidate
      onSubmit={(event) =>
        void form.handleSubmit(onValid, () => setFormError(t('fixErrors')))(event)
      }
      className="flex flex-col gap-8"
    >
      {section(
        'identity',
        <>
          {text('name', { autoComplete: 'organization', wide: true })}
          <Field>
            <FieldLabel htmlFor={`${id}-code`}>{t('fields.code')}</FieldLabel>
            <Input
              id={`${id}-code`}
              readOnly
              value={profile.code}
              className={cn(CONTROL_CLASS, 'bg-muted')}
              aria-describedby={`${id}-code-hint`}
            />
            <FieldDescription id={`${id}-code-hint`}>{t('fields.codeHint')}</FieldDescription>
          </Field>
          {select('board', options.boards, true)}
          {text('legalName', { hint: true })}
          {text('shortName', { hint: true })}
          {wrap(
            'establishedYear',
            <Controller
              control={form.control}
              name="establishedYear"
              render={({ field }) => (
                <Input
                  {...controlProps('establishedYear')}
                  ref={field.ref}
                  name={field.name}
                  className={CONTROL_CLASS}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={field.value ?? ''}
                  onBlur={field.onBlur}
                  onChange={(event) => {
                    const raw = event.target.value.trim();
                    field.onChange(raw === '' ? null : Number(raw));
                  }}
                />
              )}
            />,
          )}
          {text('udiseCode', { hint: true, inputMode: 'numeric', maxLength: 11 })}
          {text('affiliationNumber', { hint: true, maxLength: 30 })}
        </>,
      )}
      {section(
        'about',
        <>
          {select('schoolType', options.schoolTypes)}
          {select('residential', options.residential)}
          {text('medium', { hint: true, list: mediumList, wide: true })}
          {select('lowestClass', options.classes)}
          {select('highestClass', options.classes)}
        </>,
      )}
      <datalist id={mediumList}>
        {MEDIUM_SUGGESTIONS.map((medium) => (
          <option key={medium} value={medium} />
        ))}
      </datalist>
      {section(
        'contact',
        <>
          {text('phone', { type: 'tel', inputMode: 'tel', autoComplete: 'tel-national' })}
          {text('email', { type: 'email', autoComplete: 'email' })}
          {text('website', { hint: true, type: 'url', inputMode: 'url', wide: true })}
        </>,
      )}
      {section(
        'address',
        <>
          {text('addressLine1', { autoComplete: 'address-line1', wide: true })}
          {text('addressLine2', { autoComplete: 'address-line2', wide: true })}
          {text('city', { autoComplete: 'address-level2' })}
          {text('district')}
          {select('state', options.states, true)}
          {text('pinCode', { inputMode: 'numeric', autoComplete: 'postal-code', maxLength: 6 })}
        </>,
      )}
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription role="alert">{formError}</AlertDescription>
        </Alert>
      ) : null}
      <div>
        <Button type="submit" className={BUTTON_CLASS} disabled={update.isPending}>
          {update.isPending ? <Spinner aria-hidden="true" /> : null}
          {update.isPending ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}
