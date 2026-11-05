'use client';

import {
  getListClassSubjectsQueryKey,
  type SubjectDto,
  useGetSchoolProfile,
  useListClassSubjects,
  useListSubjects,
  useReplaceClassSubjects,
} from '@classloom/api-client';
import { type ClassLevel, type ClassSubjectKind, isSeniorClass } from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Badge } from '@classloom/ui/components/ui/badge';
import { Button } from '@classloom/ui/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@classloom/ui/components/ui/collapsible';
import { Field, FieldDescription, FieldLabel } from '@classloom/ui/components/ui/field';
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
import { IconCheck, IconChevronDown, IconCircleDashed } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';

import { Link } from '@/i18n/navigation';

import { BUTTON_CLASS } from '../auth/auth-ui';
import { useLeaveGuard } from '../onboarding/leave-guard';
import { useAcademicsErrorText } from './academics-errors';
import { ArchivedBadge, ListState, TabIntro, TRIGGER_CLASS } from './academics-ui';
import {
  canAddCell,
  cellKey,
  type CellMap,
  classRowsOf,
  gridClasses,
  gridColumns,
  nextKind,
  refusedField,
  refusedRow,
  rowsForClass,
  sameClassRows,
  toCellMap,
  withCell,
} from './class-subjects-helpers';

const HEADING_ID = 'class-subjects-heading';
/** The stream selector's "All streams" value. */
const ALL = 'all';
/** The profile changes rarely; its own form refreshes it. */
const PROFILE_STALE_MS = 5 * 60_000;
const LINK_CLASS =
  'text-primary-strong focus-visible:ring-ring/50 inline-flex min-h-11 items-center font-medium underline underline-offset-4 outline-none focus-visible:ring-3';

/** The class's row header (from `md`) and accordion trigger (below): one of them is shown. */
const rowHeaderId = (level: ClassLevel) => `class-subjects-row-${level}`;
const accordionId = (level: ClassLevel) => `class-subjects-class-${level}`;

/** Focuses the class's visible heading, else the tab's. */
function focusClass(level: ClassLevel) {
  for (const id of [rowHeaderId(level), accordionId(level), HEADING_ID]) {
    const element = document.getElementById(id);
    if (element && element.getClientRects().length > 0) {
      element.focus();
      return;
    }
  }
}

interface GridRow {
  classLevel: ClassLevel;
  outsideRange: boolean;
}

/**
 * The Class subjects tab (spec section 8): the school's classes against its subjects, each cell
 * not taught, compulsory or optional. For XI and XII a stream selector switches between the
 * all-streams rows and each stream's own. From `md` a table, below it one accordion per class.
 * Changes are saved one class at a time; editing another class, or leaving, asks first.
 */
export function ClassSubjectsGrid({
  canEdit,
  canManageSettings,
}: {
  canEdit: boolean;
  canManageSettings: boolean;
}) {
  const t = useTranslations('academics.classSubjects');
  const tSubjects = useTranslations('academics.subjects');
  const tClass = useTranslations('schoolSettings.profile.classLevels');
  const errorText = useAcademicsErrorText();
  const queryClient = useQueryClient();
  const streamFieldId = useId();
  const hintId = useId();
  const subjects = useListSubjects();
  const classSubjects = useListClassSubjects();
  const profile = useGetSchoolProfile({ query: { staleTime: PROFILE_STALE_MS } });
  const replace = useReplaceClassSubjects();
  const [draft, setDraft] = useState<{ level: ClassLevel; map: CellMap } | null>(null);
  const [stream, setStream] = useState<string>(ALL);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saved = useMemo(
    () => toCellMap(classRowsOf(classSubjects.data?.classes ?? [])),
    [classSubjects.data],
  );
  const dirty = draft !== null && !sameClassRows(draft.map, saved, draft.level);
  const draftClass = draft ? tClass(draft.level) : '';
  const { guard, dialog } = useLeaveGuard(dirty, {
    title: t('guardTitle'),
    body: t('guardBody', { class: draftClass }),
    leave: t('guardLeave'),
    stay: t('guardStay'),
  });

  const queries = [subjects, classSubjects, profile];
  const loaded = subjects.data && classSubjects.data && profile.data;
  if (!loaded) {
    return (
      <div className="flex flex-col gap-6">
        <TabIntro
          headingId={HEADING_ID}
          title={t('title')}
          description={t('description')}
          canEdit={canEdit}
          readOnlyNotice={tSubjects('readOnlyNotice')}
        />
        <ListState
          isError={queries.some((q) => q.isError && !q.isPending)}
          onRetry={() => queries.forEach((q) => void q.refetch())}
        />
      </div>
    );
  }

  const range = {
    lowest: profile.data.lowestClass ?? null,
    highest: profile.data.highestClass ?? null,
  };
  const rangeSet = range.lowest !== null && range.highest !== null;
  const rows = gridClasses(range, classSubjects.data.classes);
  const columns = gridColumns(subjects.data.subjects, saved);
  const seniorRows = rows.filter((row) => isSeniorClass(row.classLevel));
  // Active streams, then archived ones a senior class still has.
  const mappedStreams = new Set(
    seniorRows.flatMap((row) =>
      rowsForClass(saved, row.classLevel).flatMap((r) => (r.streamId ? [r.streamId] : [])),
    ),
  );
  const streamOptions = classSubjects.data.streams.filter(
    (s) => s.status === 'ACTIVE' || mappedStreams.has(s.id),
  );
  const streamItems = [
    { value: ALL, label: t('allStreams') },
    ...[...streamOptions]
      .sort((a, b) => Number(a.status === 'ARCHIVED') - Number(b.status === 'ARCHIVED'))
      .map((s) => ({
        value: s.id,
        label: s.status === 'ARCHIVED' ? t('archivedStream', { name: s.name }) : s.name,
      })),
  ];
  const showStreams = seniorRows.length > 0 && streamOptions.length > 0;
  const selected = showStreams && streamOptions.some((s) => s.id === stream) ? stream : ALL;
  const selectedName = streamOptions.find((s) => s.id === selected)?.name ?? '';
  const archived = new Set([
    ...subjects.data.subjects.filter((s) => s.status === 'ARCHIVED').map((s) => s.id),
    ...classSubjects.data.streams.filter((s) => s.status === 'ARCHIVED').map((s) => s.id),
  ]);

  const mapFor = (level: ClassLevel): CellMap =>
    draft && draft.level === level ? draft.map : saved;
  const streamFor = (level: ClassLevel) =>
    isSeniorClass(level) && selected !== ALL ? selected : null;
  const classLabel = (level: ClassLevel) =>
    streamFor(level)
      ? t('classStream', { class: tClass(level), stream: selectedName })
      : tClass(level);

  function toggle(level: ClassLevel, subjectId: string) {
    const streamId = streamFor(level);
    const apply = (base: CellMap) => {
      setSaveError(null);
      setDraft({
        level,
        map: withCell(
          base,
          level,
          streamId,
          subjectId,
          nextKind(base.get(cellKey(level, streamId, subjectId))),
        ),
      });
    };
    if (draft && draft.level !== level) guard(() => apply(saved));
    else apply(draft?.map ?? saved);
  }

  async function save() {
    if (!draft) return;
    const { level } = draft;
    const body = rowsForClass(draft.map, level);
    setSaveError(null);
    try {
      await replace.mutateAsync({ classLevel: level, data: { rows: body } });
      await queryClient.invalidateQueries({ queryKey: getListClassSubjectsQueryKey() });
      setDraft(null);
      focusClass(level);
      toast.add({ title: t('saved', { class: tClass(level) }), type: 'success' });
    } catch (error) {
      // Name what the refusal is about: the stream for a `rows.N.streamId` path, else the subject.
      const row = refusedRow(error, body);
      const streamId = refusedField(error) === 'streamId' ? row?.streamId : null;
      const name = streamId
        ? classSubjects.data?.streams.find((s) => s.id === streamId)?.name
        : row && subjects.data?.subjects.find((s) => s.id === row.subjectId)?.name;
      setSaveError(
        name ? t('refusedRow', { subject: name, message: errorText(error) }) : errorText(error),
      );
    }
  }

  function discard() {
    if (!draft) return;
    const { level } = draft;
    setDraft(null);
    setSaveError(null);
    focusClass(level);
  }

  const cellProps = (row: GridRow, subject: SubjectDto) => {
    const level = row.classLevel;
    const streamId = streamFor(level);
    const kind = mapFor(level).get(cellKey(level, streamId, subject.id));
    const addable = canAddCell(saved, level, streamId, subject.id, archived);
    return {
      kind,
      label: t('cellLabel', {
        subject: subject.name,
        class: classLabel(level),
        state: t(`kinds.${kind ?? 'NONE'}`),
      }),
      editable: canEdit && !row.outsideRange && (kind !== undefined || addable),
      blocked: canEdit && !row.outsideRange && kind === undefined && !addable,
      busy: replace.isPending,
      hintId,
      onToggle: () => toggle(level, subject.id),
    };
  };

  const classCount = (level: ClassLevel) =>
    new Set(rowsForClass(mapFor(level), level).map((r) => r.subjectId)).size;
  const unsavedBadge = (level: ClassLevel) =>
    dirty && draft?.level === level ? (
      <Badge
        variant="outline"
        className="border-warning-strong/40 bg-warning-tint text-warning-strong h-6 px-2.5"
      >
        {t('unsaved')}
      </Badge>
    ) : null;
  const outsideBadge = (row: GridRow) =>
    row.outsideRange ? (
      <Badge
        variant="outline"
        className="border-warning-strong/40 bg-warning-tint text-warning-strong h-6 px-2.5"
      >
        {t('outsideRange')}
      </Badge>
    ) : null;
  const subjectMeta = (subject: SubjectDto) => (
    <>
      {subject.code ? (
        <span className="text-muted-foreground block text-xs font-normal">
          {tSubjects('code', { code: subject.code })}
        </span>
      ) : null}
      {subject.status === 'ARCHIVED' ? (
        <span className="mt-1 block">
          <ArchivedBadge />
        </span>
      ) : null}
    </>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TabIntro
        headingId={HEADING_ID}
        title={t('title')}
        description={t('description')}
        canEdit={canEdit}
        readOnlyNotice={tSubjects('readOnlyNotice')}
      />
      {/* What each press does, for every cell that points at it. */}
      <span id={hintId} className="sr-only">
        {t('cycleHint')}
      </span>

      {!rangeSet ? (
        <Alert>
          <AlertDescription className="flex flex-col items-start gap-1">
            {canManageSettings ? (
              <>
                <span>{t('classesNotSet')}</span>
                <Link href="/settings/school-profile" className={LINK_CLASS}>
                  {t('classesNotSetLink')}
                </Link>
              </>
            ) : (
              <span>{t('classesNotSetAsk')}</span>
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {columns.length === 0 ? (
        <div className="flex flex-col items-start gap-1">
          <p className="text-muted-foreground">{t('noSubjects')}</p>
          <Link href="/subjects" className={LINK_CLASS}>
            {t('noSubjectsLink')}
          </Link>
        </div>
      ) : rows.length > 0 ? (
        <>
          {showStreams ? (
            <Field className="max-w-sm">
              <FieldLabel htmlFor={streamFieldId}>{t('stream')}</FieldLabel>
              <Select
                items={streamItems}
                value={selected}
                onValueChange={(value) => {
                  if (value) setStream(value);
                }}
              >
                <SelectTrigger
                  id={streamFieldId}
                  aria-describedby={`${streamFieldId}-hint`}
                  className={TRIGGER_CLASS}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {streamItems.map((option) => (
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
              <FieldDescription id={`${streamFieldId}-hint`}>{t('streamHint')}</FieldDescription>
            </Field>
          ) : null}
          {rows.some((row) => row.outsideRange) ? (
            <p className="text-muted-foreground text-sm">{t('outsideRangeHint')}</p>
          ) : null}

          {/* From `md`: classes down the side, subjects across the top. */}
          <div
            role="region"
            aria-label={t('region')}
            tabIndex={0}
            className="bg-card focus-visible:ring-ring/50 hidden overflow-x-auto rounded-xl border outline-none focus-visible:ring-3 md:block"
          >
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{t('caption')}</caption>
              <thead>
                <tr className="border-border border-b">
                  <th
                    scope="col"
                    className="bg-card sticky left-0 z-[1] px-4 py-3 text-left align-bottom font-medium"
                  >
                    {t('class')}
                  </th>
                  {columns.map((subject) => (
                    <th
                      key={subject.id}
                      scope="col"
                      className="min-w-32 px-2 py-3 text-center align-bottom font-medium"
                    >
                      <span className="block break-words">{subject.name}</span>
                      {subjectMeta(subject)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.classLevel} className="border-border border-b last:border-b-0">
                    <th
                      scope="row"
                      className="bg-card sticky left-0 z-[1] min-w-40 px-4 py-2 text-left align-middle font-medium"
                    >
                      <span
                        id={rowHeaderId(row.classLevel)}
                        tabIndex={-1}
                        className="block outline-none"
                      >
                        {classLabel(row.classLevel)}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {outsideBadge(row)}
                        {unsavedBadge(row.classLevel)}
                      </span>
                    </th>
                    {columns.map((subject) => (
                      <td key={subject.id} className="px-2 py-1.5 text-center">
                        <CellControl {...cellProps(row, subject)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Below `md`: one accordion per class, its subjects listed down. */}
          <ul className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => (
              <li key={row.classLevel}>
                <Collapsible className="bg-card rounded-xl border">
                  <h3>
                    {/* Named by the class alone; the count and badges below describe it. */}
                    <CollapsibleTrigger
                      id={accordionId(row.classLevel)}
                      aria-describedby={`${accordionId(row.classLevel)}-details`}
                      className="group focus-visible:ring-ring/50 flex min-h-11 w-full items-center justify-between gap-3 rounded-t-xl px-4 pt-3 pb-1 text-left font-medium outline-none focus-visible:ring-3"
                    >
                      <span className="min-w-0 break-words">{classLabel(row.classLevel)}</span>
                      <IconChevronDown
                        aria-hidden="true"
                        className="size-5 shrink-0 transition-transform group-data-[panel-open]:rotate-180"
                      />
                    </CollapsibleTrigger>
                  </h3>
                  <p
                    id={`${accordionId(row.classLevel)}-details`}
                    className="text-muted-foreground flex flex-wrap items-center gap-1 px-4 pb-3 text-sm"
                  >
                    <span>{t('count', { count: classCount(row.classLevel) })}</span>
                    {outsideBadge(row)}
                    {unsavedBadge(row.classLevel)}
                  </p>
                  <CollapsibleContent>
                    <ul className="border-border divide-y border-t">
                      {columns.map((subject) => (
                        <li
                          key={subject.id}
                          className="flex items-center justify-between gap-3 px-4 py-2"
                        >
                          <span className="min-w-0 text-sm break-words">
                            {subject.name}
                            {subjectMeta(subject)}
                          </span>
                          <CellControl {...cellProps(row, subject)} />
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {dirty ? (
        <div className="bg-card sticky bottom-4 z-10 flex flex-col gap-3 rounded-xl border p-4 shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-medium">{t('unsavedBar', { class: draftClass })}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className={BUTTON_CLASS}
                disabled={replace.isPending}
                onClick={discard}
              >
                {t('discard')}
              </Button>
              <Button
                className={BUTTON_CLASS}
                disabled={replace.isPending}
                onClick={() => void save()}
              >
                {replace.isPending ? <Spinner aria-hidden="true" /> : null}
                {t('save', { class: draftClass })}
              </Button>
            </div>
          </div>
          {saveError ? (
            <Alert variant="destructive">
              <AlertDescription role="alert">{saveError}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}

      {dialog}
    </div>
  );
}

const CELL_CLASS =
  'inline-flex h-10 min-w-28 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-sm font-medium pointer-coarse:h-11';

/** What a cell shows: an icon and a word for compulsory or optional, a dash for not taught. */
function CellFace({ kind }: { kind: ClassSubjectKind | undefined }) {
  const t = useTranslations('academics.classSubjects.kinds');
  if (kind === 'COMPULSORY') {
    return (
      <>
        <IconCheck aria-hidden="true" className="size-4" />
        {t('COMPULSORY')}
      </>
    );
  }
  if (kind === 'OPTIONAL') {
    return (
      <>
        <IconCircleDashed aria-hidden="true" className="size-4" />
        {t('OPTIONAL')}
      </>
    );
  }
  return <span aria-hidden="true">—</span>;
}

const faceClass = (kind: ClassSubjectKind | undefined) =>
  kind === 'COMPULSORY'
    ? 'border-primary bg-primary text-primary-foreground'
    : kind === 'OPTIONAL'
      ? 'border-primary-strong/60 text-primary-strong border-dashed'
      : 'border-border text-muted-foreground';

/**
 * One cell. Editable, a button whose name says the subject, the class and the state, and whose
 * description says what a press does; otherwise the same face, named for screen readers.
 */
function CellControl({
  kind,
  label,
  editable,
  blocked,
  busy,
  hintId,
  onToggle,
}: {
  kind: ClassSubjectKind | undefined;
  label: string;
  editable: boolean;
  blocked: boolean;
  /** A save is in flight: a press now would be lost, so the cell waits. */
  busy: boolean;
  hintId: string;
  onToggle: () => void;
}) {
  const t = useTranslations('academics.classSubjects');
  if (editable) {
    return (
      <button
        type="button"
        aria-label={label}
        aria-describedby={hintId}
        disabled={busy}
        onClick={onToggle}
        className={cn(
          CELL_CLASS,
          faceClass(kind),
          'focus-visible:ring-ring/50 cursor-pointer outline-none focus-visible:ring-3 disabled:cursor-wait disabled:opacity-60',
          kind === undefined && 'hover:bg-muted',
        )}
      >
        <CellFace kind={kind} />
      </button>
    );
  }
  return (
    <span className={cn(CELL_CLASS, faceClass(kind), kind === undefined && 'border-transparent')}>
      <span aria-hidden="true" className="inline-flex items-center gap-1.5">
        <CellFace kind={kind} />
      </span>
      <span className="sr-only">
        {label}
        {blocked ? ` ${t('cantAdd')}` : ''}
      </span>
    </span>
  );
}
