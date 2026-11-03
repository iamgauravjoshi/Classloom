'use client';

import {
  getGetOnboardingQueryKey,
  getListCampusesQueryKey,
  useDeactivateCampus,
  useListCampuses,
  useMakeCampusPrimary,
  useReactivateCampus,
} from '@classloom/api-client';
import { type Campus, INDIAN_STATES } from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Badge } from '@classloom/ui/components/ui/badge';
import { Button } from '@classloom/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@classloom/ui/components/ui/dialog';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { cn } from '@classloom/ui/lib/utils';
import { IconPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { BUTTON_CLASS } from '../auth/auth-ui';
import { useLastShown } from '../iam/iam-ui';
import { CampusForm } from './campus-form';
import { schoolErrorMessage } from './school-errors';
import { ConfirmDialog } from './years-list';

const MAX_CAMPUSES = 20;

const stateName = (code: string) => INDIAN_STATES.find((s) => s.code === code)?.name ?? code;

/** The campus's address on one line: the lines, the city, the district, the state and the PIN. */
function addressOf(campus: Campus): string {
  return [
    campus.addressLine1,
    campus.addressLine2,
    campus.city,
    campus.district,
    stateName(campus.state),
    campus.pinCode,
  ]
    .filter((part) => part !== null && part !== '')
    .join(', ');
}

/**
 * The school's campuses (spec §7, §10), primary first: cards at `md` and wider, a list below.
 * With `canEdit` each offers Edit, Make primary and Deactivate or Reactivate, and refusals show
 * their §11 message.
 */
export function CampusesList({ campuses, canEdit }: { campuses: Campus[]; canEdit: boolean }) {
  const t = useTranslations('schoolSettings.campuses');
  const tErrors = useTranslations('schoolSettings.errors');
  const queryClient = useQueryClient();
  const router = useRouter();
  const makePrimary = useMakeCampusPrimary();
  const deactivate = useDeactivateCampus();
  const reactivate = useReactivateCampus();
  const [form, setForm] = useState<{ campus?: Campus } | null>(null);
  const [deactivating, setDeactivating] = useState<Campus | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // While a dialog fades out it keeps the wording it opened with.
  const shownForm = useLastShown(form);
  const shownDeactivating = useLastShown(deactivating);

  const sorted = [...campuses].sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      Number(b.isActive) - Number(a.isActive) ||
      a.name.localeCompare(b.name),
  );
  const atLimit = campuses.length >= MAX_CAMPUSES;
  const busy = makePrimary.isPending || deactivate.isPending || reactivate.isPending;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListCampusesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetOnboardingQueryKey() });
    router.refresh();
  };

  async function run(action: 'makePrimary' | 'reactivate', campus: Campus) {
    setListError(null);
    try {
      if (action === 'makePrimary') await makePrimary.mutateAsync({ id: campus.id });
      else await reactivate.mutateAsync({ id: campus.id });
      refresh();
      toast.add({
        title: t(action === 'makePrimary' ? 'madePrimary' : 'reactivated', { name: campus.name }),
        type: 'success',
      });
    } catch (error) {
      setListError(tErrors(schoolErrorMessage(error)));
    }
  }

  async function confirmDeactivate() {
    if (!deactivating) return;
    try {
      await deactivate.mutateAsync({ id: deactivating.id });
      refresh();
      toast.add({ title: t('deactivated', { name: deactivating.name }), type: 'success' });
      setDeactivating(null);
    } catch (error) {
      setDeactivateError(tErrors(schoolErrorMessage(error)));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {!canEdit ? (
        <Alert>
          <AlertDescription>{t('readOnlyNotice')}</AlertDescription>
        </Alert>
      ) : null}
      {canEdit ? (
        <div className="flex flex-col items-start gap-2">
          <Button className={BUTTON_CLASS} disabled={atLimit} onClick={() => setForm({})}>
            <IconPlus aria-hidden="true" />
            {t('add')}
          </Button>
          {atLimit ? <p className="text-muted-foreground text-sm">{t('limitReached')}</p> : null}
        </div>
      ) : null}
      {listError ? (
        <Alert variant="destructive">
          <AlertDescription role="alert">{listError}</AlertDescription>
        </Alert>
      ) : null}

      {/* One list: rows divided by rules on small screens, a grid of cards from `md`. */}
      <ul className="bg-card divide-y rounded-xl border md:grid md:grid-cols-2 md:gap-4 md:divide-y-0 md:border-0 md:bg-transparent">
        {sorted.map((campus) => (
          <li
            key={campus.id}
            className="md:bg-card flex min-w-0 flex-col gap-3 p-4 md:rounded-xl md:border md:p-5 md:shadow-xs"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="text-h6 min-w-0 break-words">{campus.name}</h2>
              {campus.isPrimary ? (
                <Badge variant="outline" className="bg-primary-tint text-primary-strong h-6 px-2.5">
                  {t('primary')}
                </Badge>
              ) : null}
              <Badge
                variant="outline"
                className={cn(
                  'h-6 px-2.5',
                  campus.isActive
                    ? 'bg-success-tint text-success-strong'
                    : 'border-border text-muted-foreground',
                )}
              >
                {campus.isActive ? t('active') : t('inactive')}
              </Badge>
            </div>
            <p className={cn('break-words', !campus.addressLine1 && 'text-muted-foreground')}>
              {campus.addressLine1 ? addressOf(campus) : t('noAddress')}
            </p>
            {campus.phone || campus.email ? (
              <p className="text-muted-foreground text-sm break-words">
                {[campus.phone, campus.email].filter(Boolean).join(' · ')}
              </p>
            ) : null}
            {canEdit ? (
              <div className="flex flex-wrap gap-2 md:mt-auto">
                <Button
                  variant="outline"
                  className={BUTTON_CLASS}
                  aria-label={t('editLabel', { name: campus.name })}
                  onClick={() => setForm({ campus })}
                >
                  {t('edit')}
                </Button>
                {campus.isActive && !campus.isPrimary ? (
                  <Button
                    variant="outline"
                    className={BUTTON_CLASS}
                    disabled={busy}
                    aria-label={t('makePrimaryLabel', { name: campus.name })}
                    onClick={() => void run('makePrimary', campus)}
                  >
                    {t('makePrimary')}
                  </Button>
                ) : null}
                {campus.isActive && !campus.isPrimary ? (
                  <Button
                    variant="outline"
                    className={cn(BUTTON_CLASS, 'text-danger-strong')}
                    disabled={busy}
                    aria-label={t('deactivateLabel', { name: campus.name })}
                    onClick={() => {
                      setDeactivateError(null);
                      setDeactivating(campus);
                    }}
                  >
                    {t('deactivate')}
                  </Button>
                ) : null}
                {!campus.isActive ? (
                  <Button
                    variant="outline"
                    className={BUTTON_CLASS}
                    disabled={busy}
                    aria-label={t('reactivateLabel', { name: campus.name })}
                    onClick={() => void run('reactivate', campus)}
                  >
                    {t('reactivate')}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <Dialog
        open={form !== null}
        onOpenChange={(next) => {
          if (!next) setForm(null);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-xl">
          <div className="flex flex-col gap-2 pr-8">
            <DialogTitle className="text-h6">
              {shownForm?.campus
                ? t('form.editTitle', { name: shownForm.campus.name })
                : t('form.createTitle')}
            </DialogTitle>
            <DialogDescription>{t('form.description')}</DialogDescription>
          </div>
          {shownForm ? (
            <CampusForm
              campus={shownForm.campus}
              onSaved={() => setForm(null)}
              onCancel={() => setForm(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deactivating !== null}
        title={t('deactivateDialog.title', { name: shownDeactivating?.name ?? '' })}
        body={<p>{t('deactivateDialog.body')}</p>}
        action={t('deactivateDialog.action')}
        pendingLabel={t('deactivateDialog.pending')}
        cancelLabel={t('cancel')}
        destructive
        pending={deactivate.isPending}
        errorText={deactivateError}
        onConfirm={() => void confirmDeactivate()}
        onClose={() => setDeactivating(null)}
      />
    </div>
  );
}

/** The Campuses page body, once `GET /school/campuses?status=all` has answered. */
export function CampusesSection({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('schoolSettings.campuses');
  const { data, isPending, isError, refetch } = useListCampuses({ status: 'all' });

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
  const campuses: Campus[] = data.campuses;
  return <CampusesList campuses={campuses} canEdit={canEdit} />;
}
