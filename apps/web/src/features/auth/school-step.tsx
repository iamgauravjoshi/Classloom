'use client';

import { AuthCard } from '@classloom/ui/components/auth-card';
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
import type { FormEvent, ReactNode } from 'react';

import { Link } from '@/i18n/navigation';

import type { SchoolLookupErrorKey } from './auth-errors';
import { BUTTON_CLASS, CONTROL_CLASS, LINK_CLASS } from './auth-ui';

export type SchoolStepError = 'required' | SchoolLookupErrorKey;

interface SchoolStepProps {
  logo: ReactNode;
  copyright: string;
  code: string;
  onCodeChange: (code: string) => void;
  error?: SchoolStepError;
  pending: boolean;
  autoFocus: boolean;
  /** Called with `required` for an empty field, else with nothing (look the code up). */
  onSubmit: (error?: SchoolStepError) => void;
}

/** Step 1: which school. */
export function SchoolStep({
  logo,
  copyright,
  code,
  onCodeChange,
  error,
  pending,
  autoFocus,
  onSubmit,
}: SchoolStepProps) {
  const t = useTranslations('auth');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    onSubmit(code.trim() === '' ? 'required' : undefined);
  }

  let message: string | undefined;
  if (error === 'required') message = t('signIn.school.required');
  else if (error === 'notFound') message = t('signIn.school.notFound');
  else if (error) message = t(`errors.${error}`);

  return (
    <AuthCard
      logo={logo}
      copyright={copyright}
      title={t('signIn.school.title')}
      description={t('signIn.school.description')}
      footer={t.rich('signIn.school.register', {
        link: (chunks) => (
          <Link href="/register-school" className={LINK_CLASS}>
            {chunks}
          </Link>
        ),
      })}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <FieldGroup>
          <Field data-invalid={Boolean(message)}>
            <FieldLabel htmlFor="school-code">{t('signIn.school.label')}</FieldLabel>
            <Input
              id="school-code"
              name="schoolCode"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              // Only after the person moved to this step, never on first load.
              autoFocus={autoFocus}
              className={cn(CONTROL_CLASS, 'font-mono tracking-wide uppercase')}
              value={code}
              aria-invalid={Boolean(message)}
              aria-describedby={message ? 'school-code-hint school-code-error' : 'school-code-hint'}
              onChange={(event) => onCodeChange(event.target.value.toUpperCase())}
            />
            <FieldDescription id="school-code-hint">{t('signIn.school.hint')}</FieldDescription>
            <FieldError id="school-code-error">{message}</FieldError>
          </Field>
        </FieldGroup>
        <Button type="submit" className={cn(BUTTON_CLASS, 'w-full')} disabled={pending}>
          {pending ? <Spinner aria-hidden="true" /> : null}
          {pending ? t('signIn.school.checking') : t('signIn.school.continue')}
        </Button>
      </form>
    </AuthCard>
  );
}
