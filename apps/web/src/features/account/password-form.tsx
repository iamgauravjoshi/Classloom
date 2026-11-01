'use client';

import { getGetAuthSessionQueryKey, getGetMeQueryKey, useSetPassword } from '@classloom/api-client';
import type { Me } from '@classloom/contracts';
import { PasswordInput } from '@classloom/ui/components/password-input';
import { PasswordRules } from '@classloom/ui/components/password-rules';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button } from '@classloom/ui/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@classloom/ui/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@classloom/ui/components/ui/field';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

import { BUTTON_CLASS, CONTROL_CLASS } from '../auth/auth-ui';
import { passwordRuleList } from '../auth/password-rule-list';
import { passwordErrorOf } from './account-errors';
import { reauthPath } from './recent-sign-in';

type FieldErrors = { currentPassword?: string; newPassword?: string; confirmPassword?: string };

const describedBy = (id: string, error?: string, extra?: string) =>
  [extra, error ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined;

interface PasswordFormProps {
  me: Me;
  /** The school the person is signed in to: where a recent sign-in is asked for again. */
  schoolCode: string;
}

/**
 * Set a first password (needs a recent sign-in) or change the current one. Either way the
 * server signs out the person's other sessions; this one stays.
 */
export function PasswordForm({ me, schoolCode }: PasswordFormProps) {
  const t = useTranslations('account.password');
  const tAuth = useTranslations('auth');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const setPassword = useSetPassword();
  const changing = me.hasPassword;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const rules = passwordRuleList(newPassword, (key) => tAuth(`reset.rules.${key}`));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (setPassword.isPending || redirecting) return;
    setFormError(null);
    const errors: FieldErrors = {};
    if (changing && currentPassword === '') errors.currentPassword = t('currentRequired');
    if (!rules.every((rule) => rule.met)) errors.newPassword = t('lengthError');
    if (confirmPassword === '') errors.confirmPassword = t('confirmRequired');
    else if (confirmPassword !== newPassword) errors.confirmPassword = t('mismatch');
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      await setPassword.mutateAsync({
        data: changing ? { currentPassword, newPassword } : { newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.add({ title: changing ? t('changeDone') : t('setDone'), type: 'success' });
      // `hasPassword` flips, and the other sessions are gone; this one carries on.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() }),
      ]);
    } catch (error) {
      const outcome = passwordErrorOf(error);
      switch (outcome.kind) {
        case 'recentSignIn':
          // Through the email-code flow again, then back to this page.
          setRedirecting(true);
          window.location.assign(reauthPath(locale, schoolCode));
          break;
        case 'currentWrong':
          setFieldErrors({ currentPassword: t('currentWrong') });
          break;
        case 'policy':
          setFieldErrors({
            newPassword: outcome.keys.map((key) => tAuth(`reset.policy.${key}`)).join(' '),
          });
          break;
        case 'paused':
          setFormError(tAuth('signIn.credentials.paused'));
          break;
        case 'error':
          setFormError(
            outcome.key === 'temporarilyUnavailable'
              ? tAuth('reset.temporarilyUnavailable')
              : tAuth(`errors.${outcome.key}`),
          );
          break;
      }
    }
  }

  const busy = setPassword.isPending || redirecting;

  return (
    <Card>
      <form onSubmit={(event) => void onSubmit(event)} noValidate aria-labelledby="password-title">
        <CardHeader>
          <CardTitle id="password-title" role="heading" aria-level={2} className="text-h5">
            {changing ? t('changeTitle') : t('setTitle')}
          </CardTitle>
          <CardDescription>
            {changing ? t('changeDescription') : t('setDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <FieldGroup className="sm:max-w-md">
            {changing ? (
              <Field data-invalid={Boolean(fieldErrors.currentPassword)}>
                <FieldLabel htmlFor="current-password">{t('current')}</FieldLabel>
                <PasswordInput
                  id="current-password"
                  name="currentPassword"
                  autoComplete="current-password"
                  showLabel={tAuth('showPassword')}
                  hideLabel={tAuth('hidePassword')}
                  className={CONTROL_CLASS}
                  value={currentPassword}
                  aria-invalid={Boolean(fieldErrors.currentPassword)}
                  aria-describedby={describedBy('current-password', fieldErrors.currentPassword)}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
                <FieldError id="current-password-error">{fieldErrors.currentPassword}</FieldError>
              </Field>
            ) : null}
            <Field data-invalid={Boolean(fieldErrors.newPassword)}>
              <FieldLabel htmlFor="account-new-password">{t('new')}</FieldLabel>
              <PasswordInput
                id="account-new-password"
                name="newPassword"
                autoComplete="new-password"
                showLabel={tAuth('showPassword')}
                hideLabel={tAuth('hidePassword')}
                className={CONTROL_CLASS}
                value={newPassword}
                aria-invalid={Boolean(fieldErrors.newPassword)}
                aria-describedby={describedBy(
                  'account-new-password',
                  fieldErrors.newPassword,
                  'account-new-password-rules',
                )}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <div id="account-new-password-rules" className="flex flex-col gap-1.5">
                <p className="text-muted-foreground text-sm">{t('rulesLabel')}</p>
                <PasswordRules
                  rules={rules}
                  metLabel={tAuth('reset.ruleMet')}
                  unmetLabel={tAuth('reset.ruleUnmet')}
                />
              </div>
              <FieldError id="account-new-password-error">{fieldErrors.newPassword}</FieldError>
            </Field>
            <Field data-invalid={Boolean(fieldErrors.confirmPassword)}>
              <FieldLabel htmlFor="account-confirm-password">{t('confirm')}</FieldLabel>
              <PasswordInput
                id="account-confirm-password"
                name="confirmPassword"
                autoComplete="new-password"
                showLabel={tAuth('showPassword')}
                hideLabel={tAuth('hidePassword')}
                className={CONTROL_CLASS}
                value={confirmPassword}
                aria-invalid={Boolean(fieldErrors.confirmPassword)}
                aria-describedby={describedBy(
                  'account-confirm-password',
                  fieldErrors.confirmPassword,
                )}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
              <FieldError id="account-confirm-password-error">
                {fieldErrors.confirmPassword}
              </FieldError>
            </Field>
          </FieldGroup>
          {formError ? (
            <Alert variant="destructive" className="mt-6">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          {redirecting ? (
            <p role="status" className="text-muted-foreground mt-6 text-sm">
              {t('redirecting')}
            </p>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button type="submit" className={BUTTON_CLASS} disabled={busy}>
            {busy ? <Spinner aria-hidden="true" /> : null}
            {busy ? t('saving') : changing ? t('change') : t('set')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
