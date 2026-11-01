'use client';

import { useResetPassword } from '@classloom/api-client';
import { AuthCard } from '@classloom/ui/components/auth-card';
import { PasswordInput } from '@classloom/ui/components/password-input';
import { PasswordRules } from '@classloom/ui/components/password-rules';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button, buttonVariants } from '@classloom/ui/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@classloom/ui/components/ui/field';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { cn } from '@classloom/ui/lib/utils';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useState } from 'react';

import { Link } from '@/i18n/navigation';

import { type CommonErrorKey, resetErrorOf } from './auth-errors';
import { AuthLogo, BUTTON_CLASS, CONTROL_CLASS, LINK_CLASS } from './auth-ui';
import { passwordRuleList } from './password-rule-list';

type View = 'form' | 'done' | 'invalidLink';
type FieldErrors = { newPassword?: string; confirmPassword?: string };

/**
 * Reset password from an emailed link. The token leaves the address bar on load and stays in
 * memory; it is spent only when the form is submitted, so a mail scanner opening the link
 * cannot use it up.
 */
export function ResetPasswordForm() {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  // Captured on first render, before the effect removes it from the address bar.
  const [token] = useState(() => searchParams.get('token'));
  const reset = useResetPassword();
  const [view, setView] = useState<View>(token ? 'form' : 'invalidLink');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<CommonErrorKey | null>(null);

  useEffect(() => {
    if (!window.location.search.includes('token=')) return;
    // Keeps the token out of history, bookmarks, screenshots and the Referer of later requests.
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);

  const rules = passwordRuleList(newPassword, (key) => t(`reset.rules.${key}`));
  const card = { logo: <AuthLogo />, copyright: t('copyright') };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (reset.isPending || !token) return;
    setFormError(null);
    const errors: FieldErrors = {};
    if (!rules.every((rule) => rule.met)) errors.newPassword = t('reset.lengthError');
    if (confirmPassword === '') errors.confirmPassword = t('reset.confirmRequired');
    else if (confirmPassword !== newPassword) errors.confirmPassword = t('reset.mismatch');
    setFieldErrors(errors);
    if (errors.newPassword || errors.confirmPassword) return;

    try {
      await reset.mutateAsync({ data: { token, newPassword } });
      setView('done');
    } catch (error) {
      const outcome = resetErrorOf(error);
      if (outcome.kind === 'invalidLink') setView('invalidLink');
      else if (outcome.kind === 'policy') {
        setFieldErrors({
          newPassword: outcome.keys.map((key) => t(`reset.policy.${key}`)).join(' '),
        });
      } else setFormError(outcome.key);
    }
  }

  if (view === 'done') {
    return (
      <AuthCard {...card} title={t('reset.doneTitle')} description={t('reset.doneBody')}>
        <Link href="/sign-in" className={cn(buttonVariants(), BUTTON_CLASS, 'w-full')}>
          {t('reset.signIn')}
        </Link>
      </AuthCard>
    );
  }

  if (view === 'invalidLink') {
    return (
      <AuthCard
        {...card}
        title={t('reset.invalidTitle')}
        description={t('reset.invalidBody')}
        footer={
          <Link href="/sign-in" className={LINK_CLASS}>
            {t('reset.backToSignIn')}
          </Link>
        }
      >
        <Link href="/forgot-password" className={cn(buttonVariants(), BUTTON_CLASS, 'w-full')}>
          {t('reset.requestNew')}
        </Link>
      </AuthCard>
    );
  }

  const describedBy = (id: string, error?: string, extra?: string) =>
    [extra, error ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined;

  return (
    <AuthCard {...card} title={t('reset.title')} description={t('reset.description')}>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-6">
        <FieldGroup>
          <Field data-invalid={Boolean(fieldErrors.newPassword)}>
            <FieldLabel htmlFor="new-password">{t('reset.newPassword')}</FieldLabel>
            <PasswordInput
              id="new-password"
              name="newPassword"
              autoComplete="new-password"
              showLabel={t('showPassword')}
              hideLabel={t('hidePassword')}
              className={CONTROL_CLASS}
              value={newPassword}
              aria-invalid={Boolean(fieldErrors.newPassword)}
              aria-describedby={describedBy(
                'new-password',
                fieldErrors.newPassword,
                'new-password-rules',
              )}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <div id="new-password-rules" className="flex flex-col gap-1.5">
              <p className="text-muted-foreground text-sm">{t('reset.rulesLabel')}</p>
              <PasswordRules
                rules={rules}
                metLabel={t('reset.ruleMet')}
                unmetLabel={t('reset.ruleUnmet')}
              />
            </div>
            <FieldError id="new-password-error">{fieldErrors.newPassword}</FieldError>
          </Field>
          <Field data-invalid={Boolean(fieldErrors.confirmPassword)}>
            <FieldLabel htmlFor="confirm-password">{t('reset.confirmPassword')}</FieldLabel>
            <PasswordInput
              id="confirm-password"
              name="confirmPassword"
              autoComplete="new-password"
              showLabel={t('showPassword')}
              hideLabel={t('hidePassword')}
              className={CONTROL_CLASS}
              value={confirmPassword}
              aria-invalid={Boolean(fieldErrors.confirmPassword)}
              aria-describedby={describedBy('confirm-password', fieldErrors.confirmPassword)}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
            <FieldError id="confirm-password-error">{fieldErrors.confirmPassword}</FieldError>
          </Field>
        </FieldGroup>
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {formError === 'temporarilyUnavailable'
                ? t('reset.temporarilyUnavailable')
                : t(`errors.${formError}`)}
            </AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" className={cn(BUTTON_CLASS, 'w-full')} disabled={reset.isPending}>
          {reset.isPending ? <Spinner aria-hidden="true" /> : null}
          {reset.isPending ? t('reset.submitting') : t('reset.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
