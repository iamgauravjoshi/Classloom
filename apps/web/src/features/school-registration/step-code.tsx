'use client';

import { useGetCodeAvailability } from '@classloom/api-client';
import { StatusPill } from '@classloom/ui/components/status-pill';
import { Button } from '@classloom/ui/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@classloom/ui/components/ui/field';
import { Input } from '@classloom/ui/components/ui/input';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { cn } from '@classloom/ui/lib/utils';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect } from 'react';

import { BUTTON_CLASS, type CodeStatus, CONTROL_CLASS, type StepProps } from './form-types';
import { useDebouncedValue } from './use-debounced-value';

const DEBOUNCE_MS = 400;

interface StepCodeProps extends StepProps {
  /** Free code suggested by the API after a 409, shown until the code changes. */
  serverSuggestion?: string;
  onStatusChange: (status: CodeStatus) => void;
}

export function StepCode({
  values,
  errors,
  onChange,
  serverSuggestion,
  onStatusChange,
}: StepCodeProps) {
  const t = useTranslations('registration');
  const code = values.code.trim();
  const debounced = useDebouncedValue(code, DEBOUNCE_MS);
  const settled = code === debounced;

  const query = useGetCodeAvailability(
    { code: debounced, name: values.schoolName.trim(), city: values.city.trim() },
    // Always re-check on mount: a cached "Available" may have been taken since.
    { query: { enabled: debounced !== '', retry: false, staleTime: 0, gcTime: 0 } },
  );
  const result = query.data;

  let status: CodeStatus = 'idle';
  if (code !== '') {
    if (!settled || query.isFetching) status = 'checking';
    else if (query.isError) status = 'unknown';
    else if (result?.available) status = 'available';
    else if (result) status = 'unavailable';
  }

  useEffect(() => onStatusChange(status), [status, onStatusChange]);

  const suggestion = status === 'unavailable' ? result?.suggestion : serverSuggestion;

  let pill: ReactNode = null;
  let message: string | undefined;
  if (status === 'checking') {
    pill = (
      <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <Spinner aria-hidden="true" />
        {t('availability.checking')}
      </span>
    );
  } else if (status === 'available') {
    pill = <StatusPill tone="success">{t('availability.available')}</StatusPill>;
  } else if (status === 'unavailable') {
    if (result?.reason === 'taken') {
      message = t('errors.codeTaken');
      pill = (
        <StatusPill tone="danger">
          {suggestion
            ? t('availability.taken', { suggestion })
            : t('availability.takenNoSuggestion')}
        </StatusPill>
      );
    } else if (result?.reason === 'reserved') {
      pill = <StatusPill tone="danger">{t('availability.reserved')}</StatusPill>;
      message = t('availability.reservedMessage');
    } else {
      pill = <StatusPill tone="danger">{t('availability.invalid')}</StatusPill>;
      message = t('availability.invalidMessage');
    }
  } else if (status === 'unknown') {
    pill = <StatusPill tone="neutral">{t('availability.unknown')}</StatusPill>;
  }

  const fieldError = errors.code ?? message;

  return (
    <FieldGroup>
      <Field data-invalid={Boolean(fieldError)}>
        <FieldLabel htmlFor="code">{t('fields.code')}</FieldLabel>
        <Input
          id="code"
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={20}
          className={cn(CONTROL_CLASS, 'font-mono tracking-wide uppercase')}
          value={values.code}
          aria-invalid={Boolean(fieldError)}
          aria-describedby="code-status"
          onChange={(event) => onChange('code', event.target.value.toUpperCase())}
        />
        <FieldDescription>{t('fields.codeHint')}</FieldDescription>
        <div id="code-status" aria-live="polite" className="flex flex-wrap items-center gap-2">
          {pill}
          {suggestion && status !== 'checking' ? (
            <Button
              type="button"
              variant="outline"
              className={BUTTON_CLASS}
              onClick={() => onChange('code', suggestion)}
            >
              {t('availability.useSuggestion', { suggestion })}
            </Button>
          ) : null}
        </div>
        <FieldError>{fieldError}</FieldError>
      </Field>
    </FieldGroup>
  );
}
