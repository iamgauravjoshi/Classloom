'use client';

import {
  type AcademicYearDto,
  getGetOnboardingQueryKey,
  getListAcademicYearsQueryKey,
  useCreateAcademicYear,
  useUpdateAcademicYear,
} from '@classloom/api-client';
import type { TermDates } from '@classloom/contracts';
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
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { cn } from '@classloom/ui/lib/utils';
import { toISTDateString } from '@classloom/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { BUTTON_CLASS, CONTROL_CLASS } from '../auth/auth-ui';
import { schoolErrorMessage } from './school-errors';
import {
  formStateAfterDateChange,
  initialYearFormState,
  stateAfterTermEdit,
  type TermProblem,
  termsAfterConfirm,
  termsKept,
  validateYearForm,
  type YearFormChange,
  type YearFormErrors,
  type YearFormState,
} from './year-form-helpers';

/** What the form starts from: a year to edit (with `id`), or the dates of a new one. */
export interface AcademicYearFormInitial {
  id?: string;
  label?: string;
  startsOn: string;
  endsOn: string;
  terms?: TermDates[];
}

/** April to March of the academic year today falls in (IST), for a school with no year yet. */
function thisAcademicYear(): AcademicYearFormInitial {
  const [y, m] = toISTDateString(new Date()).split('-').map(Number);
  const start = m! >= 4 ? y! : y! - 1;
  return { startsOn: `${start}-04-01`, endsOn: `${start + 1}-03-31` };
}

/** The message key under `form.errors` for a term problem. */
const termErrorKey = (problem: TermProblem) => (problem === 'order' ? 'termOrder' : problem);

/**
 * An academic year's dates, label and terms (spec §6). The default terms follow the dates and the
 * count until a term's dates are edited by hand; after that it asks before replacing them. It
 * creates the year, or updates it when `initial.id` is set. The setup wizard embeds it.
 */
export function AcademicYearForm({
  initial,
  onSaved,
  onCancel,
  onDirtyChange,
  renderActions,
}: {
  initial?: AcademicYearFormInitial;
  onSaved: (year: AcademicYearDto) => void;
  onCancel?: () => void;
  /** Hears whether the form differs from what it started with (the wizard's leave guard). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Replaces the Cancel and save buttons (the wizard's step actions); a submit button saves. */
  renderActions?: (state: { pending: boolean }) => ReactNode;
}) {
  const t = useTranslations('schoolSettings.academicYears.form');
  const tErrors = useTranslations('schoolSettings.errors');
  const id = useId();
  const queryClient = useQueryClient();
  const router = useRouter();
  const create = useCreateAcademicYear();
  const update = useUpdateAcademicYear();
  const pending = create.isPending || update.isPending;
  const editingId = initial?.id;

  const [state, setState] = useState<YearFormState>(() =>
    initialYearFormState(initial ?? thisAcademicYear()),
  );
  const [startState, setStartState] = useState(state);
  const dirty = JSON.stringify(state) !== JSON.stringify(startState);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const [confirmPending, setConfirmPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  // Once a save was tried, the problems follow every change.
  const checked = validateYearForm(state);
  const errors: YearFormErrors = submitted && !checked.ok ? checked.errors : {};

  useEffect(() => {
    if (focusRequest === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);

  function change(next: YearFormChange) {
    const result = formStateAfterDateChange(state, next);
    setState(result.state);
    setConfirmPending(result.needsConfirm);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setFormError(null);
    if (!checked.ok) {
      setFormError(t('fixErrors'));
      setFocusRequest((n) => n + 1);
      return;
    }
    try {
      const saved = editingId
        ? await update.mutateAsync({ id: editingId, data: checked.body })
        : await create.mutateAsync({ data: checked.body });
      void queryClient.invalidateQueries({ queryKey: getListAcademicYearsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetOnboardingQueryKey() });
      router.refresh();
      toast.add({
        title: editingId ? t('saved') : t('created', { label: saved.label }),
        type: 'success',
      });
      setStartState(state);
      onSaved(saved);
    } catch (error) {
      setFormError(tErrors(schoolErrorMessage(error)));
    }
  }

  const fieldId = (name: string) => `${id}-${name}`;
  const describedBy = (name: string, hint: boolean, invalid: boolean) =>
    [hint ? `${fieldId(name)}-hint` : null, invalid ? `${fieldId(name)}-error` : null]
      .filter(Boolean)
      .join(' ') || undefined;

  const dateField = (name: 'startsOn' | 'endsOn') => {
    const problem = errors[name];
    return (
      <Field data-invalid={Boolean(problem)}>
        <FieldLabel htmlFor={fieldId(name)}>{t(name)}</FieldLabel>
        <Input
          id={fieldId(name)}
          className={CONTROL_CLASS}
          autoComplete="off"
          maxLength={10}
          value={state[name]}
          aria-invalid={Boolean(problem)}
          aria-describedby={describedBy(name, true, Boolean(problem))}
          onChange={(event) => change({ [name]: event.target.value } as YearFormChange)}
        />
        <FieldDescription id={`${fieldId(name)}-hint`}>{t('dateHint')}</FieldDescription>
        <FieldError id={`${fieldId(name)}-error`}>
          {problem ? t(`errors.${problem}`) : null}
        </FieldError>
      </Field>
    );
  };

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      className="flex flex-col gap-6"
    >
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {dateField('startsOn')}
        {dateField('endsOn')}
        <Field data-invalid={Boolean(errors.label)}>
          <FieldLabel htmlFor={fieldId('label')}>{t('label')}</FieldLabel>
          <Input
            id={fieldId('label')}
            className={CONTROL_CLASS}
            autoComplete="off"
            maxLength={40}
            value={state.label}
            aria-invalid={Boolean(errors.label)}
            aria-describedby={describedBy('label', true, Boolean(errors.label))}
            onChange={(event) =>
              setState((s) => ({ ...s, label: event.target.value, labelEdited: true }))
            }
          />
          <FieldDescription id={`${fieldId('label')}-hint`}>{t('labelHint')}</FieldDescription>
          <FieldError id={`${fieldId('label')}-error`}>
            {errors.label ? t('errors.label') : null}
          </FieldError>
        </Field>
        <FieldSet className="gap-2">
          <FieldLegend variant="label">{t('termCount')}</FieldLegend>
          <div className="flex gap-2">
            {([2, 3] as const).map((count) => (
              <label
                key={count}
                className={cn(
                  'border-input has-checked:border-primary has-checked:bg-primary-tint has-focus-visible:ring-ring/50 flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 has-focus-visible:ring-[3px]',
                  CONTROL_CLASS,
                )}
              >
                <input
                  type="radio"
                  name={fieldId('termCount')}
                  value={count}
                  checked={state.termCount === count}
                  aria-invalid={Boolean(errors.termCount)}
                  aria-describedby={errors.termCount ? fieldId('termCount-error') : undefined}
                  onChange={() => change({ termCount: count })}
                  className="accent-primary size-4"
                />
                {t('termCountOption', { count })}
              </label>
            ))}
          </div>
          <FieldError id={fieldId('termCount-error')}>
            {errors.termCount ? t('errors.unanswered') : null}
          </FieldError>
        </FieldSet>
      </div>

      <div aria-live="polite">
        {confirmPending ? (
          <Alert className="flex flex-col items-start gap-3">
            <AlertDescription>{t('regeneratePrompt')}</AlertDescription>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className={BUTTON_CLASS}
                onClick={() => {
                  setState((s) => termsAfterConfirm(s));
                  setConfirmPending(false);
                }}
              >
                {t('regenerateReplace')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className={BUTTON_CLASS}
                onClick={() => {
                  setState((s) => termsKept(s));
                  setConfirmPending(false);
                }}
              >
                {t('regenerateKeep')}
              </Button>
            </div>
          </Alert>
        ) : null}
      </div>

      <FieldSet className="gap-4" aria-describedby={`${id}-terms-description`}>
        <FieldLegend className="text-h6">{t('termsLegend')}</FieldLegend>
        <FieldDescription id={`${id}-terms-description`} className="-mt-3">
          {t('termsDescription')}
        </FieldDescription>
        <ol className="flex flex-col gap-4">
          {state.terms.map((row, index) => {
            const n = index + 1;
            const rowErrors = errors.terms?.[index] ?? {};
            const termInput = (field: 'name' | 'startsOn' | 'endsOn') => {
              const problem = rowErrors[field];
              const name = `term${index}-${field}`;
              const visible = { name: 'termName', startsOn: 'termStart', endsOn: 'termEnd' }[field];
              const full = {
                name: 'termNameLabel',
                startsOn: 'termStartLabel',
                endsOn: 'termEndLabel',
              }[field];
              return (
                <Field data-invalid={Boolean(problem)}>
                  <FieldLabel htmlFor={fieldId(name)}>{t(visible)}</FieldLabel>
                  <Input
                    id={fieldId(name)}
                    className={CONTROL_CLASS}
                    autoComplete="off"
                    maxLength={field === 'name' ? 60 : 10}
                    aria-label={t(full, { n })}
                    value={row[field]}
                    aria-invalid={Boolean(problem)}
                    aria-describedby={describedBy(name, false, Boolean(problem))}
                    onChange={(event) =>
                      setState((s) => stateAfterTermEdit(s, index, field, event.target.value))
                    }
                  />
                  <FieldError id={`${fieldId(name)}-error`}>
                    {problem ? t(`errors.${termErrorKey(problem)}`) : null}
                  </FieldError>
                </Field>
              );
            };
            return (
              <li key={index} className="flex flex-col gap-3 rounded-lg border p-4">
                <h3 className="text-sm font-semibold">{t('termHeading', { n })}</h3>
                <div className="grid gap-x-4 gap-y-4 sm:grid-cols-3">
                  {termInput('name')}
                  {termInput('startsOn')}
                  {termInput('endsOn')}
                </div>
              </li>
            );
          })}
        </ol>
      </FieldSet>

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription role="alert">{formError}</AlertDescription>
        </Alert>
      ) : null}
      {renderActions ? (
        renderActions({ pending })
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          {onCancel ? (
            <Button
              type="button"
              variant="outline"
              className={BUTTON_CLASS}
              disabled={pending}
              onClick={onCancel}
            >
              {t('cancel')}
            </Button>
          ) : null}
          <Button type="submit" className={BUTTON_CLASS} disabled={pending}>
            {pending ? <Spinner aria-hidden="true" /> : null}
            {pending ? t('saving') : editingId ? t('save') : t('create')}
          </Button>
        </div>
      )}
    </form>
  );
}
