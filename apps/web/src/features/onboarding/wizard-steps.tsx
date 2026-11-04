'use client';

import {
  type CampusDto,
  getUpdateCampusMutationKey,
  useGetSchoolProfile,
  useListAcademicYears,
  useListCampuses,
} from '@classloom/api-client';
import type { Campus, SchoolProfile } from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button } from '@classloom/ui/components/ui/button';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { cn } from '@classloom/ui/lib/utils';
import { IconPlus } from '@tabler/icons-react';
import { useIsMutating } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { BUTTON_CLASS } from '../auth/auth-ui';
import { AcademicYearForm } from '../school-settings/academic-year-form';
import { CampusForm } from '../school-settings/campus-form';
import { LogoField } from '../school-settings/logo-field';
import { ProfileForm } from '../school-settings/profile-form';

/** What every step hears from the wizard. */
export interface StepProps {
  /** Back to the previous step; absent on the first. */
  onBack?: () => void;
  /** On without saving (on the last step, to the dashboard). */
  onSkip: () => void;
  /** On after a save (on the last step, to the dashboard). */
  onDone: () => void;
  /** Like `onDone`, but asks first, as leaving does: other edits on the step are unsaved. */
  onDoneAsking: () => void;
  /** Whether the step's form holds unsaved edits (the leave guard). */
  onDirtyChange: (dirty: boolean) => void;
  isLast: boolean;
}

/**
 * The step's buttons: Back, Skip and the main action. Below `md` they stick to the bottom of the
 * screen, above the home indicator (safe-area inset); from `md` they sit under the form.
 */
export function StepActions({
  onBack,
  onSkip,
  primary,
}: {
  onBack?: () => void;
  onSkip?: () => void;
  primary: ReactNode;
}) {
  const t = useTranslations('onboarding.actions');
  const ref = useRef<HTMLDivElement>(null);
  // Publishes how far the bar's top sits above the bottom of the screen (its height while it
  // sticks there; more on a short page, where it sits higher), so toasts rise above it below md
  // (globals.css). Removed when the bar goes.
  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const root = document.documentElement;
    const update = () => {
      const clearance = Math.max(0, window.innerHeight - bar.getBoundingClientRect().top);
      root.style.setProperty('--step-actions-height', `${Math.round(clearance)}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    observer.observe(document.body);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
      root.style.removeProperty('--step-actions-height');
    };
  }, []);
  return (
    <div
      ref={ref}
      data-slot="step-actions"
      className={cn(
        'bg-background border-border sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t px-4 pt-3',
        'pb-[calc(0.75rem+env(safe-area-inset-bottom))]',
        'md:static md:mx-0 md:border-t md:bg-transparent md:px-0 md:pt-6 md:pb-0',
      )}
    >
      {onBack ? (
        <Button
          type="button"
          variant="ghost"
          className={cn(BUTTON_CLASS, 'mr-auto')}
          onClick={onBack}
        >
          {t('back')}
        </Button>
      ) : null}
      {onSkip ? (
        <Button type="button" variant="outline" className={BUTTON_CLASS} onClick={onSkip}>
          {t('skip')}
        </Button>
      ) : null}
      {primary}
    </div>
  );
}

/** A submit button that saves the step's form. */
function SaveButton({
  pending,
  isLast,
  form,
}: {
  pending: boolean;
  isLast: boolean;
  /** The form it submits when it sits outside it. */
  form?: string;
}) {
  const t = useTranslations('onboarding.actions');
  return (
    <Button type="submit" form={form} className={BUTTON_CLASS} disabled={pending}>
      {pending ? <Spinner aria-hidden="true" /> : null}
      {pending ? t('saving') : isLast ? t('saveAndFinish') : t('saveAndContinue')}
    </Button>
  );
}

/** Loading and load-failure states, with the step's actions so it can still be skipped. */
function StepStatus({
  isError,
  onRetry,
  step,
}: {
  isError: boolean;
  onRetry: () => void;
  step: StepProps;
}) {
  const t = useTranslations('onboarding');
  return (
    <div className="flex flex-col gap-6">
      {isError ? (
        <Alert variant="destructive" className="flex flex-col items-start gap-3">
          <AlertDescription>{t('loadError')}</AlertDescription>
          <Button variant="outline" className={BUTTON_CLASS} onClick={onRetry}>
            {t('retry')}
          </Button>
        </Alert>
      ) : (
        <p className="text-muted-foreground flex items-center gap-2" role="status">
          <Spinner aria-hidden="true" />
          {t('loading')}
        </p>
      )}
      <StepActions onBack={step.onBack} onSkip={step.onSkip} primary={null} />
    </div>
  );
}

/** Step 1: the school profile, through the Settings form. */
export function ProfileStep(step: StepProps) {
  const { data, isPending, isError, refetch } = useGetSchoolProfile();
  if (isPending || isError) {
    return <StepStatus isError={isError} onRetry={() => void refetch()} step={step} />;
  }
  const profile: SchoolProfile = data;
  return (
    <ProfileForm
      profile={profile}
      canEdit
      onSaved={step.onDone}
      onDirtyChange={step.onDirtyChange}
      renderActions={({ pending }) => (
        <StepActions
          onBack={step.onBack}
          onSkip={step.onSkip}
          primary={<SaveButton pending={pending} isLast={step.isLast} />}
        />
      )}
    />
  );
}

/** Step 2: the logo. It saves as soon as a file is chosen, so there is nothing to lose. */
export function LogoStep(step: StepProps) {
  const t = useTranslations('onboarding.actions');
  const { data, isPending, isError, refetch } = useGetSchoolProfile();
  if (isPending || isError) {
    return <StepStatus isError={isError} onRetry={() => void refetch()} step={step} />;
  }
  const hasLogo = data.logoUrl !== null;
  return (
    <div className="flex flex-col gap-6">
      <LogoField logoUrl={data.logoUrl} canEdit />
      <StepActions
        onBack={step.onBack}
        onSkip={hasLogo ? undefined : step.onSkip}
        primary={
          hasLogo ? (
            <Button type="button" className={BUTTON_CLASS} onClick={step.onDone}>
              {t('continue')}
            </Button>
          ) : null
        }
      />
    </div>
  );
}

/** Step 3: the academic year. The current year is edited when there is one, else one is created. */
export function YearStep(step: StepProps) {
  const t = useTranslations('onboarding.year');
  const { data, isPending, isError, refetch } = useListAcademicYears();
  if (isPending || isError) {
    return <StepStatus isError={isError} onRetry={() => void refetch()} step={step} />;
  }
  const current = data.years.find((year) => year.status === 'CURRENT');
  const initial = current
    ? {
        id: current.id,
        label: current.label,
        startsOn: current.startsOn,
        endsOn: current.endsOn,
        terms: [...current.terms]
          .sort((a, b) => a.seq - b.seq)
          .map(({ name, startsOn, endsOn }) => ({ name, startsOn, endsOn })),
      }
    : undefined;
  return (
    <div className="flex flex-col gap-6">
      {current ? (
        <p className="text-muted-foreground">{t('editing', { label: current.label })}</p>
      ) : null}
      <AcademicYearForm
        refreshPage={false}
        // A new form when the current year appears or changes, so it starts from it.
        key={current?.id ?? 'new'}
        initial={initial}
        onSaved={step.onDone}
        onDirtyChange={step.onDirtyChange}
        renderActions={({ pending }) => (
          <StepActions
            onBack={step.onBack}
            onSkip={step.onSkip}
            primary={<SaveButton pending={pending} isLast={step.isLast} />}
          />
        )}
      />
    </div>
  );
}

/**
 * Step 4: the primary campus's address and PIN code, plus "Add another campus", which opens the
 * Settings form for a new campus above the step's actions.
 */
export function CampusesStep(step: StepProps) {
  const t = useTranslations('onboarding.campuses');
  const { data, isPending, isError, refetch } = useListCampuses();
  const [adding, setAdding] = useState(false);
  const [primaryDirty, setPrimaryDirty] = useState(false);
  const [addDirty, setAddDirty] = useState(false);
  // Read when the primary campus's save lands, which may be after a render or two.
  const addDirtyRef = useRef(false);
  useEffect(() => {
    addDirtyRef.current = addDirty;
  }, [addDirty]);
  const [added, setAdded] = useState<CampusDto[]>([]);

  const formId = useId();
  const headingId = formId + '-heading';
  const addId = formId + '-add';
  const savingPrimary = useIsMutating({ mutationKey: getUpdateCampusMutationKey() }) > 0;
  const report = (primary: boolean, other: boolean) => step.onDirtyChange(primary || other);

  if (isPending || isError) {
    return <StepStatus isError={isError} onRetry={() => void refetch()} step={step} />;
  }
  const primary: Campus | undefined = data.campuses.find((campus) => campus.isPrimary);

  const addSection = (
    <section className="flex flex-col gap-4 border-t pt-6" aria-labelledby={addId}>
      <h3 id={addId} className="text-h6">
        {t('addHeading')}
      </h3>
      {added.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label={t('added')}>
          {added.map((campus) => (
            <li key={campus.id} className="text-muted-foreground text-sm">
              {t('addedItem', { name: campus.name })}
            </li>
          ))}
        </ul>
      ) : null}
      {adding ? (
        <CampusForm
          refreshPage={false}
          onSaved={(campus) => {
            setAdded((list) => [...list, campus]);
            setAdding(false);
            setAddDirty(false);
            report(primaryDirty, false);
          }}
          onCancel={() => {
            setAdding(false);
            setAddDirty(false);
            report(primaryDirty, false);
          }}
          onDirtyChange={(dirty) => {
            setAddDirty(dirty);
            report(primaryDirty, dirty);
          }}
        />
      ) : (
        <div>
          <Button
            type="button"
            variant="outline"
            className={BUTTON_CLASS}
            onClick={() => setAdding(true)}
          >
            <IconPlus data-icon="inline-start" />
            {t('addAnother')}
          </Button>
        </div>
      )}
    </section>
  );

  if (!primary) {
    return (
      <div className="flex flex-col gap-6">
        {addSection}
        <StepActions onBack={step.onBack} onSkip={step.onSkip} primary={null} />
      </div>
    );
  }

  // The primary campus's form keeps no buttons of its own: the step's Save button sits after
  // "Add another campus" (a form of its own, so it can't sit inside this one) and submits it.
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4" aria-labelledby={headingId}>
        <h3 id={headingId} className="text-h6">
          {t('primaryHeading', { name: primary.name })}
        </h3>
        <CampusForm
          refreshPage={false}
          key={primary.id}
          formId={formId}
          campus={primary}
          // "Save and finish" saves this form only; a half-filled "Add another campus" form is
          // not thrown away without asking.
          onSaved={() => (addDirtyRef.current ? step.onDoneAsking() : step.onDone())}
          onDirtyChange={(dirty) => {
            setPrimaryDirty(dirty);
            report(dirty, addDirty);
          }}
          renderActions={() => null}
        />
      </section>
      {addSection}
      <StepActions
        onBack={step.onBack}
        onSkip={step.onSkip}
        primary={<SaveButton pending={savingPrimary} isLast={step.isLast} form={formId} />}
      />
    </div>
  );
}
