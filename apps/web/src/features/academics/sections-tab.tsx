'use client';

import {
  type CampusDto,
  getListClassTeacherOptionsQueryKey,
  getListSectionsQueryKey,
  type SectionDto,
  useDeleteSection,
  useGetSchoolProfile,
  useListSections,
} from '@classloom/api-client';
import { type ClassLevel, sectionLabel } from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Badge } from '@classloom/ui/components/ui/badge';
import { Button } from '@classloom/ui/components/ui/button';
import { toast } from '@classloom/ui/components/ui/toast';
import { cn } from '@classloom/ui/lib/utils';
import { IconPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import {
  type SelectableYear,
  useSelectedCampus,
  useSelectedYear,
} from '@/components/shell/selection-provider';
import { Link } from '@/i18n/navigation';

import { BUTTON_CLASS } from '../auth/auth-ui';
import { useLastShown } from '../iam/iam-ui';
import { ConfirmDialog } from '../school-settings/years-list';
import { useAcademicsErrorText } from './academics-errors';
import { EmptyState, FormDialog, ListState, TabIntro } from './academics-ui';
import { CopyOffer, type CopyOutcome, CopyResult } from './copy-forward';
import { SectionForm } from './section-form';
import { type ClassGroup, groupByClass } from './section-helpers';

const HEADING_ID = 'sections-heading';
/** The profile changes rarely; its own form refreshes it. */
const PROFILE_STALE_MS = 5 * 60_000;

const classHeadingId = (level: ClassLevel) => `sections-class-${level}`;
const LINK_CLASS =
  'text-primary-strong focus-visible:ring-ring/50 inline-flex min-h-11 items-center font-medium underline underline-offset-4 outline-none focus-visible:ring-3';

/**
 * The Sections tab (spec section 8): the sections of the year chosen in the top bar and the campus
 * chosen in the sidebar, grouped by class. Switching either switches the list.
 */
/** `canManageSettings`: whether they may open the school profile to set the class range. */
export function SectionsTab({
  canEdit,
  canManageSettings,
}: {
  canEdit: boolean;
  canManageSettings: boolean;
}) {
  const t = useTranslations('academics.sections');
  const { year, years, isPending: yearPending } = useSelectedYear();
  const { campus, isPending: campusPending } = useSelectedCampus();

  if (year && campus) {
    return (
      <YearSections
        key={`${year.id}:${campus.id}`}
        year={year}
        years={years}
        campus={campus}
        canEdit={canEdit}
        canManageSettings={canManageSettings}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <TabIntro
        headingId={HEADING_ID}
        title={t('titlePlain')}
        description={t('description')}
        canEdit={canEdit}
      />
      {yearPending || campusPending ? (
        <ListState isError={false} onRetry={() => undefined} />
      ) : !year ? (
        <div className="flex flex-col items-start gap-1">
          <p className="text-muted-foreground">{t('noYear')}</p>
          <Link href="/settings/academic-years" className={LINK_CLASS}>
            {t('noYearLink')}
          </Link>
        </div>
      ) : (
        <p className="text-muted-foreground">{t('noCampus')}</p>
      )}
    </div>
  );
}

function YearSections({
  year,
  years,
  campus,
  canEdit,
  canManageSettings,
}: {
  year: SelectableYear;
  years: SelectableYear[];
  campus: CampusDto;
  canEdit: boolean;
  canManageSettings: boolean;
}) {
  const t = useTranslations('academics.sections');
  const tCommon = useTranslations('academics.common');
  const tClass = useTranslations('schoolSettings.profile.classLevels');
  const errorText = useAcademicsErrorText();
  const queryClient = useQueryClient();
  const profile = useGetSchoolProfile({ query: { staleTime: PROFILE_STALE_MS } });
  const params = { yearId: year.id, campusId: campus.id };
  const { data, isPending, isError, refetch } = useListSections(params);
  const remove = useDeleteSection();
  const [form, setForm] = useState<{ classLevel: ClassLevel; section?: SectionDto } | null>(null);
  const shownForm = useLastShown(form);
  const [deleting, setDeleting] = useState<SectionDto | null>(null);
  const shownDelete = useLastShown(deleting);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyOutcome | null>(null);
  // Where focus goes once the delete dialog closes after deleting.
  const focusOnClose = useRef<string | null>(null);

  const closed = year.status === 'CLOSED';
  const editable = canEdit && !closed;
  const range = {
    lowest: profile.data?.lowestClass ?? null,
    highest: profile.data?.highestClass ?? null,
  };
  const rangeSet = range.lowest !== null && range.highest !== null;
  const sections = data?.sections ?? [];
  const groups = groupByClass(sections, range);
  // A section added, copied or deleted takes or frees a class teacher, so the picker's options
  // (which mark who already leads a section) are refreshed with the list.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListSectionsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListClassTeacherOptionsQueryKey() });
  };

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await remove.mutateAsync({ id: deleting.id });
      // The class heading stays while its class is in range (an empty class is still listed);
      // a class outside the range leaves with its last section, so the tab's heading takes focus.
      const group = groups.find((g) => g.classLevel === deleting.classLevel);
      const classStays = group && !(group.outsideRange && group.sections.length === 1);
      focusOnClose.current = classStays ? classHeadingId(deleting.classLevel) : HEADING_ID;
      refresh();
      toast.add({
        title: tCommon('deletedToast', { name: sectionLabel(deleting.classLevel, deleting.name) }),
        type: 'success',
      });
      setDeleting(null);
    } catch (error) {
      setDeleteError(errorText(error));
    }
  }

  const loaded = data && profile.data;

  return (
    <div className="flex flex-col gap-6">
      <TabIntro
        headingId={HEADING_ID}
        title={t('title', { year: year.label, campus: campus.name })}
        description={t('description')}
        canEdit={canEdit}
      />
      {canEdit && closed ? (
        <Alert>
          <AlertDescription>{t('closedNotice', { year: year.label })}</AlertDescription>
        </Alert>
      ) : null}
      {!loaded ? (
        <ListState
          isError={(isError && !isPending) || (profile.isError && !profile.isPending)}
          onRetry={() => {
            void refetch();
            void profile.refetch();
          }}
        />
      ) : (
        <>
          {!rangeSet ? (
            <Alert>
              <AlertDescription className="flex flex-col items-start gap-1">
                {/* Only settings managers can open the profile; others are told whom to ask. */}
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
          {copied ? (
            <CopyResult
              outcome={copied}
              onDismiss={() => {
                setCopied(null);
                document.getElementById(HEADING_ID)?.focus();
              }}
            />
          ) : sections.length === 0 && rangeSet ? (
            <EmptyState
              title={t('empty', { year: year.label })}
              body={editable ? t('emptyBody') : t('emptyReadOnly')}
            >
              {editable ? (
                <CopyOffer
                  year={year}
                  years={years}
                  campusId={campus.id}
                  range={range}
                  onCopied={(outcome) => {
                    setCopied(outcome);
                    refresh();
                  }}
                  onAddFirst={() => setForm({ classLevel: groups[0]!.classLevel })}
                />
              ) : null}
            </EmptyState>
          ) : null}
          {groups.length > 0 ? (
            <div className="flex flex-col gap-8">
              {groups.map((group) => (
                <ClassSections
                  key={group.classLevel}
                  group={group}
                  editable={editable}
                  onAdd={() => setForm({ classLevel: group.classLevel })}
                  onEdit={(section) => setForm({ classLevel: section.classLevel, section })}
                  onDelete={(section) => {
                    setDeleteError(null);
                    setDeleting(section);
                  }}
                />
              ))}
            </div>
          ) : null}
        </>
      )}

      <FormDialog
        open={form !== null}
        title={
          shownForm?.section
            ? t('form.editTitle', {
                name: sectionLabel(shownForm.section.classLevel, shownForm.section.name),
              })
            : t('form.createTitle', { class: shownForm ? tClass(shownForm.classLevel) : '' })
        }
        description={t('form.description', {
          class: shownForm ? tClass(shownForm.classLevel) : '',
          year: year.label,
          campus: campus.name,
        })}
        onClose={() => setForm(null)}
      >
        {shownForm ? (
          <SectionForm
            key={shownForm.section?.id ?? `new-${shownForm.classLevel}`}
            section={shownForm.section}
            classLevel={shownForm.classLevel}
            yearId={year.id}
            campusId={campus.id}
            onSaved={() => {
              refresh();
              setForm(null);
            }}
            onCancel={() => setForm(null)}
          />
        ) : null}
      </FormDialog>

      {/* Outside the class lists, so it stays mounted when the last section goes. */}
      <ConfirmDialog
        open={deleting !== null}
        title={tCommon('deleteTitle', {
          name: shownDelete ? sectionLabel(shownDelete.classLevel, shownDelete.name) : '',
        })}
        body={<p>{t('deleteBody')}</p>}
        action={tCommon('delete')}
        pendingLabel={tCommon('deleting')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={remove.isPending}
        errorText={deleteError}
        // Deleted, the button that opened the dialog is gone: focus goes to a heading that stays.
        // Cancelled, back to the button.
        finalFocus={() => {
          const id = focusOnClose.current;
          focusOnClose.current = null;
          return (id && document.getElementById(id)) || true;
        }}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

/** One class: its heading, how many sections, an "Add section" action and the sections. */
function ClassSections({
  group,
  editable,
  onAdd,
  onEdit,
  onDelete,
}: {
  group: ClassGroup<SectionDto>;
  editable: boolean;
  onAdd: () => void;
  onEdit: (section: SectionDto) => void;
  onDelete: (section: SectionDto) => void;
}) {
  const t = useTranslations('academics.sections');
  const tClass = useTranslations('schoolSettings.profile.classLevels');
  const className = tClass(group.classLevel);
  const headingId = classHeadingId(group.classLevel);

  return (
    <section
      aria-labelledby={headingId}
      // Outside the range, the region says so: its sections can be deleted but not edited.
      aria-describedby={group.outsideRange ? `${headingId}-badge ${headingId}-state` : undefined}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 id={headingId} tabIndex={-1} className="text-h6 outline-none">
              {className}
            </h3>
            {group.outsideRange ? (
              <Badge
                id={`${headingId}-badge`}
                variant="outline"
                className="border-warning-strong/40 bg-warning-tint text-warning-strong h-6 px-2.5"
              >
                {t('outsideRange')}
              </Badge>
            ) : null}
          </div>
          <p id={`${headingId}-state`} className="text-muted-foreground text-sm">
            {group.outsideRange && editable
              ? t('outsideRangeHint')
              : t('count', { count: group.sections.length })}
          </p>
        </div>
        {editable && !group.outsideRange ? (
          <Button
            variant="outline"
            className={BUTTON_CLASS}
            aria-label={t('addLabel', { class: className })}
            onClick={onAdd}
          >
            <IconPlus aria-hidden="true" />
            {t('add')}
          </Button>
        ) : null}
      </div>
      {group.sections.length > 0 ? (
        // Rows divided by rules on small screens, a grid of cards from `md`.
        <ul className="bg-card divide-y rounded-xl border md:grid md:grid-cols-2 md:gap-4 md:divide-y-0 md:border-0 md:bg-transparent xl:grid-cols-3">
          {group.sections.map((section) => (
            <SectionItem
              key={section.id}
              section={section}
              canEdit={editable && !group.outsideRange}
              canDelete={editable}
              onEdit={() => onEdit(section)}
              onDelete={() => onDelete(section)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SectionItem({
  section,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  section: SectionDto;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('academics.sections');
  const tCommon = useTranslations('academics.common');
  const label = sectionLabel(section.classLevel, section.name);
  const details = [
    t('capacity', { count: section.capacity }),
    section.room ? t('room', { room: section.room.name }) : t('noRoom'),
    ...(section.stream ? [t('stream', { stream: section.stream.name })] : []),
  ];

  return (
    <li className="md:bg-card flex min-w-0 flex-col gap-3 p-4 md:rounded-xl md:border md:p-5 md:shadow-xs">
      <h4 className="text-h6 min-w-0 break-words">{label}</h4>
      <div className="flex flex-col gap-1 text-sm">
        <p className="text-muted-foreground break-words">{details.join(' · ')}</p>
        <p
          className={cn(
            'flex flex-wrap items-center gap-2 break-words',
            !section.classTeacher && 'text-muted-foreground',
          )}
        >
          <span className="min-w-0 break-words">
            {section.classTeacher
              ? t('teacher', { name: section.classTeacher.name })
              : t('noTeacher')}
          </span>
          {section.classTeacher && !section.classTeacher.active ? (
            <Badge variant="outline" className="border-border text-muted-foreground h-6 px-2.5">
              {t('inactive')}
            </Badge>
          ) : null}
        </p>
      </div>
      {canDelete ? (
        <div className="flex flex-wrap gap-2 md:mt-auto">
          {canEdit ? (
            <Button
              variant="outline"
              className={BUTTON_CLASS}
              aria-label={tCommon('editLabel', { name: label })}
              onClick={onEdit}
            >
              {tCommon('edit')}
            </Button>
          ) : null}
          <Button
            variant="outline"
            className={cn(BUTTON_CLASS, 'text-danger-strong')}
            aria-label={tCommon('deleteLabel', { name: label })}
            onClick={onDelete}
          >
            {tCommon('delete')}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
