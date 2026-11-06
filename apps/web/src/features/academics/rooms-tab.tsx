'use client';

import {
  type CampusDto,
  getListRoomsQueryKey,
  type RoomDto,
  useArchiveRoom,
  useCreateRoom,
  useDeleteRoom,
  useListRooms,
  useRestoreRoom,
  useUpdateRoom,
} from '@classloom/api-client';
import { type CreateRoomRequest, createRoomRequestSchema, ROOM_TYPES } from '@classloom/contracts';
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
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { useSelectedCampus } from '@/components/shell/selection-provider';

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

const HEADING_ID = 'rooms-heading';

/** The room rules of spec section 4, less the campus, which the tab supplies. */
const formSchema = createRoomRequestSchema.omit({ campusId: true });
type FormInput = Omit<CreateRoomRequest, 'campusId'>;
type FieldName = 'name' | 'type' | 'capacity' | 'floor';

/** The `rooms.form` message for a refused field. */
const ERROR_KEYS: Record<FieldName, string> = {
  name: 'nameError',
  type: 'typeError',
  capacity: 'capacityError',
  floor: 'floorError',
};

/** A new room starts as a classroom with no capacity (the field reads it as a number). */
const toFormValues = (room: RoomDto | undefined): Partial<FormInput> => ({
  name: room?.name ?? '',
  type: room?.type ?? 'CLASSROOM',
  capacity: room?.capacity,
  floor: room?.floor ?? '',
});

/**
 * The Rooms tab (spec section 8): the rooms of the campus chosen in the sidebar, active first.
 * Switching campus there switches the list.
 */
export function RoomsTab({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('academics.rooms');
  const { campus, isPending: campusPending } = useSelectedCampus();

  if (!campus) {
    return (
      <div className="flex flex-col gap-6">
        <TabIntro
          headingId={HEADING_ID}
          title={t('titleNoCampus')}
          description={t('description')}
          canEdit={canEdit}
        />
        {campusPending ? (
          <ListState isError={false} onRetry={() => undefined} />
        ) : (
          <p className="text-muted-foreground">{t('noCampus')}</p>
        )}
      </div>
    );
  }
  return <CampusRooms key={campus.id} campus={campus} canEdit={canEdit} />;
}

function CampusRooms({ campus, canEdit }: { campus: CampusDto; canEdit: boolean }) {
  const t = useTranslations('academics.rooms');
  const queryClient = useQueryClient();
  const { data, isPending, isError, refetch } = useListRooms({ campusId: campus.id });
  const archive = useArchiveRoom();
  const restore = useRestoreRoom();
  const remove = useDeleteRoom();
  const [form, setForm] = useState<{ room?: RoomDto } | null>(null);
  const shownForm = useLastShown(form);

  // Every rooms list, of this campus or any other, may hold the room that changed.
  const refresh = () => void queryClient.invalidateQueries({ queryKey: getListRoomsQueryKey() });
  const rooms = data?.rooms ?? [];

  return (
    <div className="flex flex-col gap-6">
      <TabIntro
        headingId={HEADING_ID}
        title={t('title', { campus: campus.name })}
        description={t('description')}
        canEdit={canEdit}
      />
      {!data ? (
        <ListState isError={isError && !isPending} onRetry={() => void refetch()} />
      ) : (
        <>
          {/* The 500-room limit is the school's, across campuses: the server says when. */}
          {canEdit ? (
            <AddButton label={t('add')} count={rooms.length} onClick={() => setForm({})} />
          ) : null}
          {rooms.length === 0 ? (
            <EmptyState title={t('empty', { campus: campus.name })} body={t('emptyBody')} />
          ) : null}
          {/* Mounted while empty too, so its delete dialog outlives the last item. */}
          <ItemList
            kind="rooms"
            items={rooms}
            canEdit={canEdit}
            headingId={HEADING_ID}
            details={(room) => <RoomDetails room={room} />}
            onEdit={(room) => setForm({ room })}
            archive={(id) => archive.mutateAsync({ id })}
            restore={(id) => restore.mutateAsync({ id })}
            remove={(id) => remove.mutateAsync({ id })}
            onChanged={refresh}
          />
        </>
      )}

      <FormDialog
        open={form !== null}
        title={
          shownForm?.room
            ? t('form.editTitle', { name: shownForm.room.name })
            : t('form.createTitle')
        }
        description={t('form.description', { campus: campus.name })}
        onClose={() => setForm(null)}
      >
        {shownForm ? (
          <RoomForm
            key={shownForm.room?.id ?? 'new'}
            campusId={campus.id}
            room={shownForm.room}
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

/** "Classroom · 40 seats · Floor: Ground". */
function RoomDetails({ room }: { room: RoomDto }) {
  const t = useTranslations('academics.rooms');
  const parts = [
    t(`types.${room.type}`),
    t('seats', { count: room.capacity }),
    ...(room.floor ? [t('floor', { floor: room.floor })] : []),
  ];
  return <p className="text-muted-foreground text-sm break-words">{parts.join(' · ')}</p>;
}

/** A room's name, type, capacity and floor: adds a room on `campusId`, or edits `room`. */
function RoomForm({
  campusId,
  room,
  onDone,
  onCancel,
}: {
  campusId: string;
  room?: RoomDto;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('academics.rooms.form');
  const tTypes = useTranslations('academics.rooms.types');
  const tCommon = useTranslations('academics.common');
  const errorText = useAcademicsErrorText();
  const id = useId();
  const create = useCreateRoom();
  const update = useUpdateRoom();
  const pending = create.isPending || update.isPending;
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(room),
    mode: 'onTouched',
  });
  const { errors } = form.formState;
  const typeItems = ROOM_TYPES.map((type) => ({ value: type, label: tTypes(type) }));

  async function onValid(values: FormInput) {
    setFormError(null);
    // The schema has trimmed the floor, and made a blank one null.
    const fields = { ...values, floor: values.floor ?? null };
    try {
      const saved = room
        ? await update.mutateAsync({ id: room.id, data: fields })
        : await create.mutateAsync({ data: { campusId, ...fields } });
      toast.add({
        title: tCommon(room ? 'saved' : 'created', { name: saved.name }),
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

  const hint = (name: FieldName) =>
    name === 'capacity' ? t('capacityHint') : name === 'floor' ? t('floorHint') : null;
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
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          {wrap(
            'name',
            <Input
              {...controlProps('name')}
              className={CONTROL_CLASS}
              autoComplete="off"
              maxLength={40}
              {...form.register('name')}
            />,
          )}
        </div>
        <div className="sm:col-span-2">
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
        {wrap(
          'capacity',
          <Input
            {...controlProps('capacity')}
            className={CONTROL_CLASS}
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            {...form.register('capacity', { valueAsNumber: true })}
          />,
        )}
        {wrap(
          'floor',
          <Input
            {...controlProps('floor')}
            className={CONTROL_CLASS}
            autoComplete="off"
            maxLength={20}
            {...form.register('floor')}
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
          {pending ? tCommon('saving') : room ? tCommon('save') : t('create')}
        </Button>
      </div>
    </form>
  );
}
