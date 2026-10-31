'use client';

import { useRequestPasswordReset } from '@classloom/api-client';
import { forgotPasswordRequestSchema } from '@classloom/contracts';
import { AuthCard } from '@classloom/ui/components/auth-card';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button, buttonVariants } from '@classloom/ui/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@classloom/ui/components/ui/field';
import { Input } from '@classloom/ui/components/ui/input';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { cn } from '@classloom/ui/lib/utils';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

import { Link } from '@/i18n/navigation';

import { type CommonErrorKey, forgotErrorKey } from './auth-errors';
import { AuthLogo, BUTTON_CLASS, CONTROL_CLASS, LINK_CLASS } from './auth-ui';

/** Forgot password: one field, and the same answer whether or not an account matches. */
export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const request = useRequestPasswordReset();
  const [identifier, setIdentifier] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<CommonErrorKey | null>(null);
  const [sent, setSent] = useState(false);

  const card = { logo: <AuthLogo />, copyright: t('copyright') };
  const backToSignIn = (
    <Link href="/sign-in" className={LINK_CLASS}>
      {t('forgot.backToSignIn')}
    </Link>
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (request.isPending) return;
    setFormError(null);
    const parsed = forgotPasswordRequestSchema.safeParse({ identifier });
    if (!parsed.success) {
      setFieldError(
        identifier.trim() === '' ? t('forgot.identifierRequired') : t('forgot.identifierInvalid'),
      );
      return;
    }
    setFieldError(null);
    try {
      await request.mutateAsync({ data: parsed.data });
      setSent(true);
    } catch (error) {
      setFormError(forgotErrorKey(error));
    }
  }

  if (sent) {
    return (
      <AuthCard {...card} title={t('forgot.sentTitle')}>
        <p role="status">{t('forgot.sent')}</p>
        <Link href="/sign-in" className={cn(buttonVariants(), BUTTON_CLASS, 'w-full')}>
          {t('forgot.backToSignIn')}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      {...card}
      title={t('forgot.title')}
      description={t('forgot.description')}
      footer={backToSignIn}
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-6">
        <FieldGroup>
          <Field data-invalid={Boolean(fieldError)}>
            <FieldLabel htmlFor="forgot-identifier">{t('forgot.identifier')}</FieldLabel>
            <Input
              id="forgot-identifier"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              className={CONTROL_CLASS}
              value={identifier}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? 'forgot-identifier-error' : undefined}
              onChange={(event) => setIdentifier(event.target.value)}
            />
            <FieldError id="forgot-identifier-error">{fieldError}</FieldError>
          </Field>
        </FieldGroup>
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{t(`errors.${formError}`)}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" className={cn(BUTTON_CLASS, 'w-full')} disabled={request.isPending}>
          {request.isPending ? <Spinner aria-hidden="true" /> : null}
          {request.isPending ? t('forgot.submitting') : t('forgot.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
