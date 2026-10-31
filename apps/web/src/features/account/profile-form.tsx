'use client';

import { getGetAuthSessionQueryKey, getGetMeQueryKey, useUpdateMe } from '@classloom/api-client';
import { type Me, updateMeRequestSchema } from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Badge } from '@classloom/ui/components/ui/badge';
import { Button } from '@classloom/ui/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@classloom/ui/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@classloom/ui/components/ui/field';
import { Input } from '@classloom/ui/components/ui/input';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { cn } from '@classloom/ui/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

import { BUTTON_CLASS, CONTROL_CLASS } from '../auth/auth-ui';
import { profileErrorOf } from './account-errors';
import { mobileDigits } from './use-me';

type FieldErrors = { name?: string; mobile?: string };

const describedBy = (id: string, error?: string, extra?: string) =>
  [extra, error ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined;

/** Name, email (read-only) and mobile. Sends only what changed. */
export function ProfileForm({ me }: { me: Me }) {
  const t = useTranslations('account.profile');
  const tErrors = useTranslations('auth.errors');
  const router = useRouter();
  const queryClient = useQueryClient();
  const update = useUpdateMe();
  const [name, setName] = useState(me.name);
  const [mobile, setMobile] = useState(mobileDigits(me.mobile));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (update.isPending) return;
    setFormError(null);
    const parsed = updateMeRequestSchema.safeParse({
      name,
      mobile: mobile.trim() === '' ? null : mobile,
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'name') next.name = t('nameError');
        if (issue.path[0] === 'mobile') next.mobile = t('mobileInvalid');
      }
      setFieldErrors(next);
      return;
    }
    setFieldErrors({});

    // Only what changed; `null` clears the mobile (the generated type does not show that).
    const body: { name?: string; mobile?: string | null } = {};
    if (parsed.data.name !== undefined && parsed.data.name !== me.name)
      body.name = parsed.data.name;
    if (parsed.data.mobile !== undefined && parsed.data.mobile !== me.mobile) {
      body.mobile = parsed.data.mobile;
    }
    if (Object.keys(body).length === 0) {
      toast.add({ title: t('unchanged'), type: 'info' });
      return;
    }

    try {
      await update.mutateAsync({ data: body as never });
      setName(parsed.data.name ?? name);
      setMobile(mobileDigits(parsed.data.mobile ?? null));
      toast.add({ title: t('saved'), type: 'success' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() }),
      ]);
      // The app shell shows the name from the server-rendered session.
      router.refresh();
    } catch (error) {
      const outcome = profileErrorOf(error);
      if (outcome.kind === 'field') {
        setFieldErrors({ [outcome.field]: t(outcome.key) });
      } else if (outcome.kind === 'fields') {
        setFieldErrors({
          ...(outcome.fields.includes('name') ? { name: t('nameError') } : {}),
          ...(outcome.fields.includes('mobile') ? { mobile: t('mobileInvalid') } : {}),
        });
      } else if (outcome.key === 'rateLimited') {
        setFormError(t('rateLimited'));
      } else {
        // A 503 here is the generic outage; "can't sign you in" would be the wrong words.
        setFormError(tErrors(outcome.key === 'temporarilyUnavailable' ? 'generic' : outcome.key));
      }
    }
  }

  return (
    <Card>
      <form onSubmit={(event) => void onSubmit(event)} noValidate aria-labelledby="profile-title">
        <CardHeader>
          <CardTitle id="profile-title" role="heading" aria-level={2} className="text-h5">
            {t('title')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <FieldGroup className="sm:max-w-md">
            <Field data-invalid={Boolean(fieldErrors.name)}>
              <FieldLabel htmlFor="profile-name">{t('name')}</FieldLabel>
              <Input
                id="profile-name"
                name="name"
                autoComplete="name"
                className={CONTROL_CLASS}
                value={name}
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={describedBy('profile-name', fieldErrors.name)}
                onChange={(event) => setName(event.target.value)}
              />
              <FieldError id="profile-name-error">{fieldErrors.name}</FieldError>
            </Field>
            <Field>
              <div className="flex items-center gap-2">
                <FieldLabel htmlFor="profile-email">{t('email')}</FieldLabel>
                {me.emailVerified ? <Badge variant="secondary">{t('verified')}</Badge> : null}
              </div>
              <Input
                id="profile-email"
                name="email"
                type="email"
                readOnly
                autoComplete="email"
                className={cn(CONTROL_CLASS, 'bg-muted')}
                value={me.email}
                aria-describedby="profile-email-hint"
              />
              <FieldDescription id="profile-email-hint">{t('emailHint')}</FieldDescription>
            </Field>
            <Field data-invalid={Boolean(fieldErrors.mobile)}>
              <FieldLabel htmlFor="profile-mobile">{t('mobile')}</FieldLabel>
              <Input
                id="profile-mobile"
                name="mobile"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                className={CONTROL_CLASS}
                value={mobile}
                aria-invalid={Boolean(fieldErrors.mobile)}
                aria-describedby={describedBy(
                  'profile-mobile',
                  fieldErrors.mobile,
                  'profile-mobile-hint',
                )}
                onChange={(event) => setMobile(event.target.value)}
              />
              <FieldDescription id="profile-mobile-hint">{t('mobileHint')}</FieldDescription>
              <FieldError id="profile-mobile-error">{fieldErrors.mobile}</FieldError>
            </Field>
          </FieldGroup>
          {formError ? (
            <Alert variant="destructive" className="mt-6">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button type="submit" className={BUTTON_CLASS} disabled={update.isPending}>
            {update.isPending ? <Spinner aria-hidden="true" /> : null}
            {update.isPending ? t('saving') : t('save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
