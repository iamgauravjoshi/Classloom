'use client';

import {
  type SectionDto,
  useCreateSection,
  useListClassTeacherOptions,
  useListRooms,
  useListStreams,
  useUpdateSection,
} from '@classloom/api-client';
import {
  type ClassLevel,
  createSectionRequestSchema,
  isSeniorClass,
  sectionLabel,
} from '@classloom/contracts';
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
import { zodResolver } from '@hookform/resolvers/zod';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { BUTTON_CLASS, CONTROL_CLASS } from '../auth/auth-ui';
import { useAcademicsErrorText } from './academics-errors';
import { TRIGGER_CLASS } from './academics-ui';
import {
  leadsAnotherSection,
  roomTooSmall,
  sectionErrorField,
  type SectionField,
  sectionFormReady,
} from './section-helpers';

type FormInput = {
  name: string;
  capacity: number;
  streamId?: string | null;
  roomId?: string | null;
  classTeacherMembershipId?: string | null;
};

interface Option {
  value: string | null;
  label: string;
  disabled?: boolean;
}

/** The `sections.form` message for a field the form itself refuses. */
const ERROR_KEYS: Partial<Record<SectionField, string>> = {
  name: 'nameError',
  capacity: 'capacityError',
  streamId: 'streamError',
};

const toFormValues = (section: SectionDto | undefined): Partial<FormInput> => ({
  name: section?.name ?? '',
  capacity: section?.capacity,
  streamId: section?.stream?.id ?? null,
  roomId: section?.room?.id ?? null,
  classTeacherMembershipId: section?.classTeacher?.membershipId ?? null,
});

/**
 * A section's name, capacity, stream, room and class teacher: adds a section to `classLevel` in
 * the year and campus, or edits `section`.
 *
 * - The stream field shows only for XI and XII while the school has an active stream, and is then
 *   required.
 * - Rooms are the campus's active ones; a room smaller than the section is warned about, not
 *   refused.
 * - Teachers come from the class-teacher options; one who leads another section this year is
 *   shown with it, and can't be chosen.
 * - A refusal about one field (a taken name, teacher or room) shows on that field.
 */
export function SectionForm({
  section,
  classLevel,
  yearId,
  campusId,
  onSaved,
  onCancel,
}: {
  section?: SectionDto;
  classLevel: ClassLevel;
  yearId: string;
  campusId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('academics.sections.form');
  const tCommon = useTranslations('academics.common');
  const tClass = useTranslations('schoolSettings.profile.classLevels');
  const errorText = useAcademicsErrorText();
  const id = useId();
  const create = useCreateSection();
  const update = useUpdateSection();
  const pending = create.isPending || update.isPending;
  const [formError, setFormError] = useState<string | null>(null);
  const rooms = useListRooms({ campusId });
  const streams = useListStreams();
  const teachers = useListClassTeacherOptions({ yearId });
  const ready = sectionFormReady(streams, rooms);

  const activeStreams = (streams.data?.streams ?? []).filter((s) => s.status === 'ACTIVE');
  const showStream = isSeniorClass(classLevel) && (activeStreams.length > 0 || !!section?.stream);

  const schema = useMemo(
    () =>
      createSectionRequestSchema
        .pick({
          name: true,
          capacity: true,
          streamId: true,
          roomId: true,
          classTeacherMembershipId: true,
        })
        .superRefine((values, ctx) => {
          if (showStream && !values.streamId) {
            ctx.addIssue({ code: 'custom', path: ['streamId'], message: 'required' });
          }
        }),
    [showStream],
  );
  const form = useForm<FormInput>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(section),
    mode: 'onTouched',
  });
  const { errors } = form.formState;

  const streamOptions: Option[] = [
    ...activeStreams.map((s) => ({ value: s.id, label: s.name })),
    // An archived stream the section still has, so the field shows it.
    ...(section?.stream && !activeStreams.some((s) => s.id === section.stream!.id)
      ? [{ value: section.stream.id, label: t('archivedOption', { name: section.stream.name }) }]
      : []),
  ];

  const allRooms = rooms.data?.rooms ?? [];
  const roomOptions: Option[] = [
    { value: null, label: t('noRoom') },
    ...allRooms
      .filter((r) => r.status === 'ACTIVE')
      .map((r) => ({ value: r.id, label: t('roomOption', { name: r.name, count: r.capacity }) })),
    ...(section?.room && !allRooms.some((r) => r.id === section.room!.id && r.status === 'ACTIVE')
      ? [{ value: section.room.id, label: t('archivedOption', { name: section.room.name }) }]
      : []),
  ];

  const teacherList = teachers.data?.teachers ?? [];
  const teacherOptions: Option[] = [
    { value: null, label: t('noTeacher') },
    ...teacherList.map((m) => {
      const leadsOther = leadsAnotherSection(m, section?.classTeacher?.membershipId);
      return {
        value: m.membershipId,
        label: leadsOther ? t('teacherLeads', { name: m.name, section: m.sectionName! }) : m.name,
        disabled: leadsOther,
      };
    }),
    // An inactive teacher the section still has: they stay until changed.
    ...(section?.classTeacher &&
    !teacherList.some((m) => m.membershipId === section.classTeacher!.membershipId)
      ? [
          {
            value: section.classTeacher.membershipId,
            label: t('teacherInactive', { name: section.classTeacher.name }),
          },
        ]
      : []),
  ];

  const [roomId, capacity] = useWatch({ control: form.control, name: ['roomId', 'capacity'] });
  const room = allRooms.find((r) => r.id === roomId);
  const warnRoom = room && roomTooSmall(room.capacity, Number(capacity)) ? room : null;

  async function onValid(values: FormInput) {
    setFormError(null);
    try {
      if (section) {
        // Only what changed: an unchanged archived room or stream is not re-checked.
        const original = toFormValues(section);
        const changed = Object.fromEntries(
          Object.entries(values).filter(
            ([key, value]) => original[key as keyof FormInput] !== value,
          ),
        );
        if (Object.keys(changed).length > 0) {
          await update.mutateAsync({ id: section.id, data: changed });
        }
      } else {
        await create.mutateAsync({
          data: {
            academicYearId: yearId,
            campusId,
            classLevel,
            ...values,
            streamId: showStream ? values.streamId : null,
          },
        });
      }
      toast.add({
        title: tCommon(section ? 'saved' : 'created', {
          name: sectionLabel(classLevel, values.name),
        }),
        type: 'success',
      });
      onSaved();
    } catch (caught) {
      const field = sectionErrorField(caught);
      if (field === 'name') {
        form.setError('name', { type: 'taken' }, { shouldFocus: true });
      } else if (field && (field !== 'streamId' || showStream)) {
        form.setError(field, { type: 'server', message: errorText(caught) }, { shouldFocus: true });
      } else {
        setFormError(errorText(caught));
      }
    }
  }

  const hint = (name: SectionField) =>
    name === 'name'
      ? t('nameHint')
      : name === 'capacity'
        ? t('capacityHint')
        : name === 'classTeacherMembershipId'
          ? t('teacherHint')
          : null;
  const warningId = `${id}-room-warning`;
  const controlProps = (name: SectionField) => ({
    id: `${id}-${name}`,
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby':
      [
        hint(name) ? `${id}-${name}-hint` : null,
        name === 'roomId' && warnRoom ? warningId : null,
        errors[name] ? `${id}-${name}-error` : null,
      ]
        .filter(Boolean)
        .join(' ') || undefined,
  });
  const errorMessage = (name: SectionField) => {
    const error = errors[name];
    if (!error) return null;
    if (error.type === 'taken') return t('nameTaken', { class: tClass(classLevel) });
    if (error.type === 'server') return error.message;
    return ERROR_KEYS[name] ? t(ERROR_KEYS[name]) : null;
  };
  const wrap = (name: SectionField, label: string, control: ReactNode) => (
    <Field data-invalid={Boolean(errors[name])}>
      <FieldLabel htmlFor={`${id}-${name}`}>{label}</FieldLabel>
      {control}
      {hint(name) ? (
        <FieldDescription id={`${id}-${name}-hint`}>{hint(name)}</FieldDescription>
      ) : null}
      <FieldError id={`${id}-${name}-error`}>{errorMessage(name)}</FieldError>
    </Field>
  );
  const select = (
    name: 'streamId' | 'roomId' | 'classTeacherMembershipId',
    options: Option[],
    placeholder: string,
  ) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <Select
          items={options}
          value={field.value ?? null}
          onValueChange={(value) => field.onChange(value ?? null)}
        >
          <SelectTrigger
            ref={field.ref}
            {...controlProps(name)}
            className={TRIGGER_CLASS}
            onBlur={field.onBlur}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {options.map((option) => (
              <SelectItem
                key={option.value ?? ''}
                value={option.value}
                disabled={option.disabled}
                className="pointer-coarse:py-2.5"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  );

  return (
    <form
      noValidate
      onSubmit={(event) =>
        void form.handleSubmit(onValid, () => setFormError(tCommon('fixErrors')))(event)
      }
      className="flex flex-col gap-6"
    >
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {wrap(
          'name',
          t('name'),
          <Input
            {...controlProps('name')}
            className={CONTROL_CLASS}
            autoComplete="off"
            maxLength={20}
            {...form.register('name')}
          />,
        )}
        {wrap(
          'capacity',
          t('capacity'),
          <Input
            {...controlProps('capacity')}
            className={CONTROL_CLASS}
            inputMode="numeric"
            autoComplete="off"
            maxLength={3}
            {...form.register('capacity', { valueAsNumber: true })}
          />,
        )}
        {showStream ? (
          <div className="sm:col-span-2">
            {wrap('streamId', t('stream'), select('streamId', streamOptions, t('chooseStream')))}
          </div>
        ) : null}
        <div className="sm:col-span-2">
          {wrap('roomId', t('room'), select('roomId', roomOptions, t('noRoom')))}
          {/* Polite and always present, so the warning is announced when it appears. */}
          <div id={warningId} aria-live="polite">
            {warnRoom ? (
              <p className="mt-2 flex items-start gap-2 text-sm">
                <IconAlertTriangle
                  aria-hidden="true"
                  className="text-warning-strong mt-0.5 size-4 shrink-0"
                />
                {t('roomTooSmall', {
                  room: warnRoom.name,
                  seats: warnRoom.capacity,
                  capacity: Number(capacity),
                })}
              </p>
            ) : null}
          </div>
        </div>
        <div className="sm:col-span-2">
          {wrap(
            'classTeacherMembershipId',
            t('teacher'),
            select('classTeacherMembershipId', teacherOptions, t('noTeacher')),
          )}
        </div>
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
        <Button type="submit" className={BUTTON_CLASS} disabled={pending || !ready}>
          {pending ? <Spinner aria-hidden="true" /> : null}
          {pending ? tCommon('saving') : section ? tCommon('save') : t('create')}
        </Button>
      </div>
    </form>
  );
}
