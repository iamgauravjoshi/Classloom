'use client';

import {
  ApiError,
  getCodeAvailability,
  useCancelSchoolRegistration,
  useCreateSchoolRegistration,
} from '@classloom/api-client';
import { schoolRegistrationRequestSchema } from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button } from '@classloom/ui/components/ui/button';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { cn } from '@classloom/ui/lib/utils';
import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { CheckInbox } from './check-inbox';
import {
  BUTTON_CLASS,
  type CodeStatus,
  EMPTY_VALUES,
  FIELD_STEP,
  type FieldErrors,
  type FieldName,
  type FormValues,
  type Step,
  TEXT_FIELDS,
} from './form-types';
import { StepAdmin } from './step-admin';
import { StepCode } from './step-code';
import { StepSchool } from './step-school';
import {
  type RegistrationDraft,
  type RegistrationDraftApi,
  useRegistrationDraft,
} from './use-registration-draft';

const STEPS: readonly Step[] = [1, 2, 3];
const STEP_KEYS = { 1: 'school', 2: 'code', 3: 'admin' } as const;

const STEP_SCHEMAS = {
  1: schoolRegistrationRequestSchema.pick({
    schoolName: true,
    board: true,
    city: true,
    state: true,
  }),
  2: schoolRegistrationRequestSchema.pick({ code: true }),
  3: schoolRegistrationRequestSchema.pick({
    adminName: true,
    email: true,
    mobile: true,
    acceptTerms: true,
  }),
} as const;

const isField = (path: unknown): path is FieldName =>
  typeof path === 'string' && path in EMPTY_VALUES;

/** The step shown by the browser's current history entry (so Back/Forward move between steps). */
function stepFromHistory(): Step {
  const raw: unknown = (window.history.state as { regStep?: unknown } | null)?.regStep;
  return raw === 2 || raw === 3 ? raw : 1;
}

interface Submitted {
  maskedEmail: string;
  email: string;
  code: string;
  /** Withdraws this pending registration. Held in memory only, never in the stored draft. */
  cancelToken: string;
}

/** Waits for the stored draft to be readable so server and client markup match. */
export function RegistrationForm() {
  const { draft, hydrated, save, clear } = useRegistrationDraft();
  if (!hydrated) return <div className="min-h-96" aria-busy="true" />;
  return <RegistrationFormBody draft={draft} save={save} clear={clear} />;
}

function initialValues(draft: RegistrationDraft): FormValues {
  const values = { ...EMPTY_VALUES };
  for (const field of TEXT_FIELDS) {
    const stored = draft[field];
    if (typeof stored === 'string') values[field] = stored;
  }
  return values;
}

function RegistrationFormBody({
  draft,
  save,
  clear,
}: Pick<RegistrationDraftApi, 'draft' | 'save' | 'clear'>) {
  const t = useTranslations('registration');
  const create = useCreateSchoolRegistration();
  const cancel = useCancelSchoolRegistration();
  const [cancelFailed, setCancelFailed] = useState(false);

  const [values, setValues] = useState<FormValues>(() => initialValues(draft));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [step, setStep] = useState<Step>(stepFromHistory);
  const [codeEdited, setCodeEdited] = useState(() => (draft.code ?? '') !== '');
  const [codeStatus, setCodeStatus] = useState<CodeStatus>('idle');
  const [serverSuggestion, setServerSuggestion] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stepChanged = useRef(false);

  // Browser Back/Forward moves between steps.
  useEffect(() => {
    const onPopState = () => setStep(stepFromHistory());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Move focus to the new step's heading (not on first render).
  useEffect(() => {
    if (!stepChanged.current) {
      stepChanged.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const onChange = useCallback(
    <K extends FieldName>(field: K, value: FormValues[K]) => {
      setValues((current) => ({ ...current, [field]: value }));
      setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
      setFormError(undefined);
      if (field === 'code') {
        setCodeEdited(true);
        setServerSuggestion(undefined);
      }
      if (field !== 'acceptTerms') save({ [field]: value });
    },
    [save],
  );

  // Pre-fill the suggested code when entering step 2 (unless the user chose one).
  const { schoolName, city } = values;
  useEffect(() => {
    if (step !== 2 || codeEdited) return;
    let stale = false;
    getCodeAvailability({ name: schoolName.trim(), city: city.trim() })
      .then((result) => {
        if (stale || !result.suggestion) return;
        setValues((current) => ({ ...current, code: result.suggestion ?? current.code }));
        save({ code: result.suggestion });
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [step, codeEdited, schoolName, city, save]);

  const goTo = useCallback((target: Step) => {
    window.history.pushState({ regStep: target }, '');
    setStep(target);
  }, []);

  const messageFor = useCallback((field: FieldName) => t(`errors.${field}`), [t]);

  function validateStep(target: Step): boolean {
    const result = STEP_SCHEMAS[target].safeParse(values);
    if (result.success) return true;
    const next: FieldErrors = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (isField(field) && !next[field]) next[field] = messageFor(field);
    }
    setErrors((current) => ({ ...current, ...next }));
    return false;
  }

  function onNext() {
    if (!validateStep(step)) return;
    // The availability message is already on screen; do not move on with a code known to be unusable.
    if (step === 2 && codeStatus === 'unavailable') return;
    if (step < 3) goTo((step + 1) as Step);
  }

  function onBack() {
    if (step === 1) return;
    if (window.history.state && stepFromHistory() === step) window.history.back();
    else setStep((step - 1) as Step);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (step < 3) {
      onNext();
      return;
    }
    setFormError(undefined);
    const parsed = schoolRegistrationRequestSchema.safeParse(values);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (isField(field) && !next[field]) next[field] = messageFor(field);
      }
      setErrors(next);
      const first = Object.keys(next)
        .map((field) => FIELD_STEP[field as FieldName])
        .sort()[0];
      if (first && first !== step) goTo(first);
      return;
    }

    try {
      const response = await create.mutateAsync({ data: parsed.data });
      setSubmitted({
        maskedEmail: response.maskedEmail,
        email: parsed.data.email,
        code: parsed.data.code,
        cancelToken: response.cancelToken,
      });
      clear();
    } catch (error) {
      handleSubmitError(error);
    }
  }

  function handleSubmitError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setFormError(t('errors.generic'));
      return;
    }
    if (error.status === 409) {
      setErrors({ code: t('errors.codeTaken') });
      setServerSuggestion(error.problem.suggestion);
      goTo(2);
      return;
    }
    if (error.status === 400 && error.problem.errors?.length) {
      const next: FieldErrors = {};
      for (const issue of error.problem.errors) {
        if (isField(issue.path) && !next[issue.path]) next[issue.path] = messageFor(issue.path);
      }
      if (Object.keys(next).length > 0) {
        setErrors(next);
        setFormError(t('errors.summary'));
        const first = Object.keys(next)
          .map((field) => FIELD_STEP[field as FieldName])
          .sort()[0];
        if (first && first !== step) goTo(first);
        return;
      }
    }
    if (error.status === 429) setFormError(t('errors.rateLimited'));
    else if (error.status === 0) setFormError(t('errors.network'));
    else setFormError(t('errors.generic'));
  }

  /**
   * "Use a different email": withdraw the pending registration first, so its code is free to
   * submit again and the mistyped address's link stops working. If that fails, stay here: going
   * back would only end in "code taken".
   */
  async function onChangeEmail(pending: Submitted) {
    setCancelFailed(false);
    try {
      await cancel.mutateAsync({ data: { cancelToken: pending.cancelToken } });
    } catch {
      setCancelFailed(true);
      return;
    }
    setSubmitted(null);
    setValues((current) => ({ ...current, acceptTerms: false }));
  }

  if (submitted) {
    return (
      <CheckInbox
        maskedEmail={submitted.maskedEmail}
        email={submitted.email}
        code={submitted.code}
        changingEmail={cancel.isPending}
        changeEmailFailed={cancelFailed}
        onChangeEmail={() => void onChangeEmail(submitted)}
      />
    );
  }

  const stepKey = STEP_KEYS[step];
  const submitting = create.isPending;
  const nextBlocked = step === 2 && codeStatus === 'checking';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-h3">{t('header.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('header.subtitle')}</p>
      </header>

      <nav aria-label={t('progress.label')}>
        <ol className="flex gap-2">
          {STEPS.map((number) => (
            <li
              key={number}
              aria-current={number === step ? 'step' : undefined}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                number <= step ? 'bg-primary' : 'bg-muted',
              )}
            >
              <span className="sr-only">
                {t('progress.step', {
                  current: number,
                  total: STEPS.length,
                  name: t(`progress.${STEP_KEYS[number]}`),
                })}
              </span>
            </li>
          ))}
        </ol>
        <p className="text-muted-foreground mt-2 text-sm" aria-hidden="true">
          {t('progress.step', {
            current: step,
            total: STEPS.length,
            name: t(`progress.${stepKey}`),
          })}
        </p>
      </nav>

      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 ref={headingRef} tabIndex={-1} className="text-h4 outline-none">
            {t(`steps.${stepKey}.title`)}
          </h2>
          <p className="text-muted-foreground text-sm">{t(`steps.${stepKey}.description`)}</p>
        </div>

        {step === 1 ? <StepSchool values={values} errors={errors} onChange={onChange} /> : null}
        {step === 2 ? (
          <StepCode
            values={values}
            errors={errors}
            onChange={onChange}
            serverSuggestion={serverSuggestion}
            onStatusChange={setCodeStatus}
          />
        ) : null}
        {step === 3 ? <StepAdmin values={values} errors={errors} onChange={onChange} /> : null}

        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          {step > 1 ? (
            <Button
              type="button"
              variant="outline"
              className={cn(BUTTON_CLASS, 'sm:min-w-24')}
              onClick={onBack}
            >
              {t('actions.back')}
            </Button>
          ) : (
            <span />
          )}
          {step < 3 ? (
            <Button
              key="next"
              type="button"
              className={cn(BUTTON_CLASS, 'sm:min-w-24')}
              disabled={nextBlocked}
              onClick={onNext}
            >
              {t('actions.next')}
            </Button>
          ) : (
            <Button
              key="submit"
              type="submit"
              className={cn(BUTTON_CLASS, 'sm:min-w-32')}
              disabled={submitting}
            >
              {submitting ? <Spinner aria-hidden="true" /> : null}
              {t('actions.submit')}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
