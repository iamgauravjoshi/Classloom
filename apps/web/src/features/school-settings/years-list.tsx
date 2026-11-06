'use client';

import {
  getGetOnboardingQueryKey,
  getListAcademicYearsQueryKey,
  useDeleteAcademicYear,
  useListAcademicYears,
  useMakeAcademicYearCurrent,
} from '@classloom/api-client';
import { type AcademicYear, nextYearDates } from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Badge } from '@classloom/ui/components/ui/badge';
import { Button } from '@classloom/ui/components/ui/button';
import { Card, CardContent } from '@classloom/ui/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@classloom/ui/components/ui/dialog';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { cn } from '@classloom/ui/lib/utils';
import { toISTDateString } from '@classloom/utils';
import { IconCalendarPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ComponentProps, type ReactNode, useState } from 'react';

import { BUTTON_CLASS } from '../auth/auth-ui';
import { useLastShown } from '../iam/iam-ui';
import { AcademicYearForm, type AcademicYearFormInitial } from './academic-year-form';
import { schoolErrorMessage, schoolErrorValues } from './school-errors';
import { formatYmd } from './year-form-helpers';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  action: string;
  pendingLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  pending: boolean;
  errorText: string | null;
  onConfirm: () => void;
  onClose: () => void;
  /** Where focus goes when the dialog closes; by default, back to what opened it. */
  finalFocus?: ComponentProps<typeof DialogContent>['finalFocus'];
}

/** A yes-or-no question before a change, with the refusal shown inside it. */
export function ConfirmDialog({
  open,
  title,
  body,
  action,
  pendingLabel,
  cancelLabel,
  destructive,
  pending,
  errorText,
  onConfirm,
  onClose,
  finalFocus,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!pending}
        finalFocus={finalFocus}
        className="gap-5 sm:max-w-md"
      >
        <div className="flex flex-col gap-2 pr-8">
          <DialogTitle className="text-h6">{title}</DialogTitle>
          <DialogDescription render={<div />}>{body}</DialogDescription>
        </div>
        {errorText ? (
          <Alert variant="destructive">
            <AlertDescription role="alert">{errorText}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className={BUTTON_CLASS}
            disabled={pending}
            onClick={onClose}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            className={BUTTON_CLASS}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? <Spinner aria-hidden="true" /> : null}
            {pending ? pendingLabel : action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_CLASS: Record<AcademicYear['status'], string> = {
  CURRENT: 'bg-success-tint text-success-strong',
  PLANNED: 'bg-info-tint text-info-strong',
  CLOSED: 'border-border text-muted-foreground',
};

/** The status pill of a year. */
function StatusPill({ status }: { status: AcademicYear['status'] }) {
  const t = useTranslations('schoolSettings.academicYears.status');
  return (
    <Badge variant="outline" className={cn('h-6 px-2.5', STATUS_CLASS[status])}>
      {t(status)}
    </Badge>
  );
}

type FormMode =
  | { kind: 'create'; initial?: AcademicYearFormInitial }
  | { kind: 'next'; initial: AcademicYearFormInitial }
  | { kind: 'edit'; initial: AcademicYearFormInitial; label: string };

/**
 * The school's academic years (spec §6, §10): each with its status, dates and terms. With
 * `canEdit` it offers "Set up academic year" (no years yet), "Prepare next year" (until a planned
 * year exists), Edit, "Make current" with a confirmation, and Delete for a planned year.
 */
export function YearsList({ years, canEdit }: { years: AcademicYear[]; canEdit: boolean }) {
  const t = useTranslations('schoolSettings.academicYears');
  const tErrors = useTranslations('schoolSettings.errors');
  const queryClient = useQueryClient();
  const router = useRouter();
  const makeCurrent = useMakeAcademicYearCurrent();
  const remove = useDeleteAcademicYear();
  const [form, setForm] = useState<FormMode | null>(null);
  const [confirming, setConfirming] = useState<{
    kind: 'makeCurrent' | 'delete';
    year: AcademicYear;
  } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // While a dialog fades out it keeps the wording it opened with.
  const shownForm = useLastShown(form);
  const shownConfirm = useLastShown(confirming);

  const current = years.find((year) => year.status === 'CURRENT');
  const planned = years.find((year) => year.status === 'PLANNED');
  const today = toISTDateString(new Date());

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListAcademicYearsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetOnboardingQueryKey() });
    router.refresh();
  };

  const openConfirm = (kind: 'makeCurrent' | 'delete', year: AcademicYear) => {
    setConfirmError(null);
    setConfirming({ kind, year });
  };

  async function confirm() {
    if (!confirming) return;
    const { kind, year } = confirming;
    try {
      if (kind === 'makeCurrent') await makeCurrent.mutateAsync({ id: year.id });
      else await remove.mutateAsync({ id: year.id });
      refresh();
      toast.add({
        title:
          kind === 'makeCurrent'
            ? t('makeCurrentDialog.done', { label: year.label })
            : t('deleteDialog.done', { label: year.label }),
        type: 'success',
      });
      setConfirming(null);
    } catch (error) {
      setConfirmError(tErrors(schoolErrorMessage(error), schoolErrorValues(error)));
    }
  }

  const headerAction = !canEdit ? null : years.length === 0 ? (
    <Button className={BUTTON_CLASS} onClick={() => setForm({ kind: 'create' })}>
      <IconCalendarPlus aria-hidden="true" />
      {t('setUp')}
    </Button>
  ) : current && !planned ? (
    <Button
      className={BUTTON_CLASS}
      onClick={() => setForm({ kind: 'next', initial: nextYearDates(current) })}
    >
      <IconCalendarPlus aria-hidden="true" />
      {t('prepareNext')}
    </Button>
  ) : null;

  const formTitle =
    shownForm?.kind === 'edit'
      ? t('form.editTitle', { label: shownForm.label })
      : shownForm?.kind === 'next'
        ? t('form.nextTitle')
        : t('form.createTitle');

  const confirmYear = shownConfirm?.year;
  const confirmBody =
    shownConfirm?.kind === 'makeCurrent' && confirmYear ? (
      <>
        {confirmYear.startsOn > today ? (
          <p>
            {t('makeCurrentDialog.early', {
              label: confirmYear.label,
              date: formatYmd(confirmYear.startsOn),
            })}
          </p>
        ) : null}
        {current ? <p>{t('makeCurrentDialog.closes', { current: current.label })}</p> : null}
      </>
    ) : (
      <p>{t('deleteDialog.body')}</p>
    );

  return (
    <div className="flex flex-col gap-6">
      {!canEdit ? (
        <Alert>
          <AlertDescription>{t('readOnlyNotice')}</AlertDescription>
        </Alert>
      ) : null}
      {headerAction ? <div className="flex flex-wrap gap-2">{headerAction}</div> : null}

      {years.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-2 py-6">
            <h2 className="text-h5">{t('emptyTitle')}</h2>
            <p className="text-muted-foreground">{canEdit ? t('emptyBody') : t('emptyReadOnly')}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {years.map((year) => (
            <li key={year.id}>
              <Card>
                <CardContent className="flex flex-col gap-4 py-5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <h2 className="text-h5">{year.label}</h2>
                    <StatusPill status={year.status} />
                  </div>
                  <p className="text-muted-foreground -mt-2">
                    {t('dates', { start: formatYmd(year.startsOn), end: formatYmd(year.endsOn) })}
                  </p>
                  <div className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold">{t('termsHeading')}</h3>
                    <ol className="grid gap-2 sm:grid-cols-3">
                      {[...year.terms]
                        .sort((a, b) => a.seq - b.seq)
                        .map((term) => (
                          <li key={term.id} className="bg-muted/50 rounded-md px-3 py-2">
                            <span className="block font-medium break-words">{term.name}</span>
                            <span className="text-muted-foreground text-sm">
                              {t('dates', {
                                start: formatYmd(term.startsOn),
                                end: formatYmd(term.endsOn),
                              })}
                            </span>
                          </li>
                        ))}
                    </ol>
                  </div>
                  {canEdit && year.status !== 'CLOSED' ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className={BUTTON_CLASS}
                        aria-label={t('editLabel', { label: year.label })}
                        onClick={() =>
                          setForm({
                            kind: 'edit',
                            label: year.label,
                            initial: {
                              id: year.id,
                              label: year.label,
                              startsOn: year.startsOn,
                              endsOn: year.endsOn,
                              terms: [...year.terms]
                                .sort((a, b) => a.seq - b.seq)
                                .map(({ name, startsOn, endsOn }) => ({ name, startsOn, endsOn })),
                            },
                          })
                        }
                      >
                        {t('edit')}
                      </Button>
                      {year.status === 'PLANNED' ? (
                        <>
                          <Button
                            variant="outline"
                            className={BUTTON_CLASS}
                            aria-label={t('makeCurrentLabel', { label: year.label })}
                            onClick={() => openConfirm('makeCurrent', year)}
                          >
                            {t('makeCurrent')}
                          </Button>
                          <Button
                            variant="outline"
                            className={cn(BUTTON_CLASS, 'text-danger-strong')}
                            aria-label={t('deleteLabel', { label: year.label })}
                            onClick={() => openConfirm('delete', year)}
                          >
                            {t('delete')}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={form !== null}
        onOpenChange={(next) => {
          if (!next) setForm(null);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-2xl">
          <div className="flex flex-col gap-2 pr-8">
            <DialogTitle className="text-h6">{formTitle}</DialogTitle>
            <DialogDescription>{t('form.description')}</DialogDescription>
          </div>
          {shownForm ? (
            <AcademicYearForm
              initial={shownForm.initial}
              onSaved={() => setForm(null)}
              onCancel={() => setForm(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming !== null}
        title={
          shownConfirm?.kind === 'makeCurrent'
            ? t('makeCurrentDialog.title', { label: confirmYear?.label ?? '' })
            : t('deleteDialog.title', { label: confirmYear?.label ?? '' })
        }
        body={confirmBody}
        action={
          shownConfirm?.kind === 'makeCurrent'
            ? t('makeCurrentDialog.action')
            : t('deleteDialog.action')
        }
        pendingLabel={
          shownConfirm?.kind === 'makeCurrent'
            ? t('makeCurrentDialog.pending')
            : t('deleteDialog.pending')
        }
        cancelLabel={t('cancel')}
        destructive={shownConfirm?.kind === 'delete'}
        pending={makeCurrent.isPending || remove.isPending}
        errorText={confirmError}
        onConfirm={() => void confirm()}
        onClose={() => setConfirming(null)}
      />
    </div>
  );
}

/** The Academic years page body, once `GET /school/academic-years` has answered. */
export function YearsSection({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('schoolSettings.academicYears');
  const { data, isPending, isError, refetch } = useListAcademicYears();

  if (isPending) {
    return (
      <p className="text-muted-foreground flex items-center gap-2" role="status">
        <Spinner aria-hidden="true" />
        {t('loading')}
      </p>
    );
  }
  if (isError) {
    return (
      <Alert variant="destructive" className="flex flex-col items-start gap-3">
        <AlertDescription>{t('loadError')}</AlertDescription>
        <Button variant="outline" className={BUTTON_CLASS} onClick={() => void refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }
  // The generated DTO and the contract describe the same response.
  const years: AcademicYear[] = data.years;
  return <YearsList years={years} canEdit={canEdit} />;
}
