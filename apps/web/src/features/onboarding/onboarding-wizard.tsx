'use client';

import {
  getGetOnboardingQueryKey,
  useGetOnboarding,
  useStartOnboarding,
} from '@classloom/api-client';
import { cn } from '@classloom/ui/lib/utils';
import { IconCheck } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type ComponentType, useCallback, useEffect, useRef, useState } from 'react';

import { useRouter } from '@/i18n/navigation';

import { useLeaveGuard } from './leave-guard';
import { WIZARD_STEPS, type WizardStep } from './wizard-step-keys';
import { CampusesStep, LogoStep, ProfileStep, type StepProps, YearStep } from './wizard-steps';

const STEP_BODIES: Record<WizardStep, ComponentType<StepProps>> = {
  profile: ProfileStep,
  logo: LogoStep,
  academicYear: YearStep,
  campuses: CampusesStep,
};

/**
 * The first-run setup wizard (spec §9): profile, logo, academic year and campuses, each through
 * its Settings form. Opening it records the start, so the dashboard never sends anyone here again.
 * The stepper's ticks come from the checklist. "Skip" moves on without saving; a step with unsaved
 * edits asks before it is left. The last step ends on the dashboard.
 */
export function OnboardingWizard({ initialStep }: { initialStep: WizardStep }) {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const queryClient = useQueryClient();
  const checklist = useGetOnboarding();
  const start = useStartOnboarding();
  const [step, setStep] = useState<WizardStep>(initialStep);
  const [dirty, setDirty] = useState(false);
  const { guard, dialog } = useLeaveGuard(dirty);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const startSent = useRef(false);

  const refreshChecklist = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: getGetOnboardingQueryKey() }),
    [queryClient],
  );

  // Once per visit; the API records only the first start, so a repeat is harmless.
  useEffect(() => {
    if (startSent.current) return;
    startSent.current = true;
    start.mutate(undefined, { onSettled: refreshChecklist });
  }, [start, refreshChecklist]);

  // A new step's heading takes focus, so a screen reader hears where it is.
  useEffect(() => {
    if (moved.current) headingRef.current?.focus();
  }, [step]);

  const index = WIZARD_STEPS.indexOf(step);
  const isLast = index === WIZARD_STEPS.length - 1;

  function show(next: WizardStep) {
    moved.current = true;
    setDirty(false);
    setStep(next);
    window.history.replaceState(null, '', `?step=${next}`);
    refreshChecklist();
  }

  function finish() {
    setDirty(false);
    refreshChecklist();
    router.push('/dashboard');
  }

  const go = (offset: 1 | -1) => {
    const next = WIZARD_STEPS[index + offset];
    if (next) show(next);
    else finish();
  };

  const done = new Map(checklist.data?.items.map((item) => [item.key, item.done]));
  const Body = STEP_BODIES[step];
  const headingId = `wizard-step-${step}`;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t('stepsLabel')}>
        <ol className="grid grid-cols-4 gap-2">
          {WIZARD_STEPS.map((key, n) => {
            const current = key === step;
            const complete = done.get(key) === true;
            return (
              <li key={key} className="min-w-0">
                <button
                  type="button"
                  aria-current={current ? 'step' : undefined}
                  onClick={() => {
                    if (!current) guard(() => show(key));
                  }}
                  className={cn(
                    'hover:bg-muted focus-visible:ring-ring/50 flex min-h-11 w-full flex-col items-center gap-1 rounded-lg border px-1 py-2 text-center outline-none focus-visible:ring-[3px] md:flex-row md:gap-3 md:px-3 md:text-left',
                    current ? 'border-primary bg-primary-tint' : 'border-border',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                      complete
                        ? 'bg-success-tint text-success-strong'
                        : current
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground',
                    )}
                  >
                    {complete ? <IconCheck className="size-4" /> : n + 1}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-xs leading-tight font-medium break-words md:text-sm">
                      {t(`steps.${key}.short`)}
                    </span>
                    <span className="sr-only">{complete ? t('stepDone') : t('stepNotDone')}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section
        aria-labelledby={headingId}
        className="md:bg-card md:ring-foreground/10 flex flex-col gap-6 md:rounded-xl md:p-6 md:ring-1"
      >
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm">
            {t('stepOf', { n: index + 1, total: WIZARD_STEPS.length })}
          </p>
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-h4 outline-none">
            {t(`steps.${step}.title`)}
          </h2>
          <p className="text-muted-foreground">{t(`steps.${step}.description`)}</p>
        </div>
        <Body
          key={step}
          onBack={index > 0 ? () => guard(() => go(-1)) : undefined}
          onSkip={() => guard(() => go(1))}
          onDone={() => go(1)}
          onDirtyChange={setDirty}
          isLast={isLast}
        />
      </section>
      {dialog}
    </div>
  );
}
