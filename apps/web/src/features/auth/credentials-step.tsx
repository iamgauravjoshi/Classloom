'use client';

import {
  type PublicSchoolDto,
  useRequestSignInCode,
  useSignInWithPassword,
} from '@classloom/api-client';
import { passwordSignInRequestSchema } from '@classloom/contracts';
import { AuthCard } from '@classloom/ui/components/auth-card';
import { PasswordInput } from '@classloom/ui/components/password-input';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button } from '@classloom/ui/components/ui/button';
import { Checkbox } from '@classloom/ui/components/ui/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@classloom/ui/components/ui/field';
import { Input } from '@classloom/ui/components/ui/input';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { cn } from '@classloom/ui/lib/utils';
import { parseIdentifier } from '@classloom/utils';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useState } from 'react';

import { Link } from '@/i18n/navigation';

import {
  codeRequestErrorKey,
  type EmailErrorKey,
  type SignInErrorKey,
  signInErrorKey,
} from './auth-errors';
import { BUTTON_CLASS, CONTROL_CLASS, LINK_CLASS } from './auth-ui';
import { reusableCode, type SentCode, sentCode } from './sent-code';
import type { TwoFactorChallenge } from './two-factor-step';

interface CredentialsStepProps {
  logo: ReactNode;
  copyright: string;
  school: PublicSchoolDto;
  identifier: string;
  onIdentifierChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  keepSignedIn: boolean;
  onKeepSignedInChange: (value: boolean) => void;
  autoFocus: boolean;
  /** The code emailed last, reused when asking again within 60 seconds. */
  lastCode: SentCode | null;
  onChangeSchool: () => void;
  onCodeSent: (code: SentCode) => void;
  /** The password was right but a second step is due. */
  onChallenge: (challenge: TwoFactorChallenge) => void;
  onSignedIn: () => void;
  /** A problem from before this step opened (the code that should have been sent). */
  initialError?: EmailErrorKey;
}

type FieldErrors = { identifier?: string; password?: string };
type FormError = SignInErrorKey | EmailErrorKey;

/** Step 2: who you are. Password sign-in, or an emailed code for an email address. */
export function CredentialsStep({
  logo,
  copyright,
  school,
  identifier,
  onIdentifierChange,
  password,
  onPasswordChange,
  keepSignedIn,
  onKeepSignedInChange,
  autoFocus,
  lastCode,
  onChangeSchool,
  onCodeSent,
  onChallenge,
  onSignedIn,
  initialError,
}: CredentialsStepProps) {
  const t = useTranslations('auth');
  const signIn = useSignInWithPassword();
  const requestCode = useRequestSignInCode();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<FormError | null>(initialError ?? null);

  const parsedIdentifier = parseIdentifier(identifier);
  const canEmailCode = parsedIdentifier.kind === 'email';
  const busy = signIn.isPending || requestCode.isPending;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    const parsed = passwordSignInRequestSchema.safeParse({
      schoolCode: school.code,
      identifier,
      password,
      remember: keepSignedIn,
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'identifier') {
          next.identifier =
            identifier.trim() === ''
              ? t('signIn.credentials.identifierRequired')
              : t('signIn.credentials.identifierInvalid');
        }
        if (issue.path[0] === 'password') next.password = t('signIn.credentials.passwordRequired');
      }
      setFieldErrors(next);
      return;
    }
    setFieldErrors({});
    try {
      const result = await signIn.mutateAsync({ data: parsed.data });
      if ('twoFactorRequired' in result) {
        onChallenge({ challenge: result.challenge, expiresAt: Date.parse(result.expiresAt) });
        return;
      }
      onSignedIn();
    } catch (error) {
      setFormError(signInErrorKey(error));
    }
  }

  async function onEmailCode() {
    if (busy || parsedIdentifier.kind !== 'email') return;
    setFormError(null);
    setFieldErrors({});
    const email = parsedIdentifier.value;
    // The API would drop a second send within 60 seconds; show the code already on its way.
    const earlier = reusableCode(lastCode, school.code, email);
    if (earlier) {
      onCodeSent(earlier);
      return;
    }
    try {
      const { maskedEmail } = await requestCode.mutateAsync({
        data: { schoolCode: school.code, email },
      });
      onCodeSent(sentCode(school.code, email, maskedEmail));
    } catch (error) {
      setFormError(codeRequestErrorKey(error));
    }
  }

  let formMessage: string | null = null;
  if (formError === 'incorrect' || formError === 'paused') {
    formMessage = t(`signIn.credentials.${formError}`);
  } else if (formError) {
    formMessage = t(`errors.${formError}`);
  }

  const describedBy = (id: string, error?: string) => (error ? `${id}-error` : undefined);

  return (
    <AuthCard
      logo={logo}
      copyright={copyright}
      title={t('signIn.credentials.title')}
      description={
        <>
          {t.rich('signIn.credentials.signingInTo', {
            name: school.name,
            city: school.city,
            strong: (chunks) => <strong className="text-foreground font-semibold">{chunks}</strong>,
          })}
          <span aria-hidden="true"> · </span>
          <button
            type="button"
            onClick={onChangeSchool}
            aria-label={t('signIn.credentials.changeLabel')}
            className={cn(LINK_CLASS, 'cursor-pointer')}
          >
            {t('signIn.credentials.change')}
          </button>
        </>
      }
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-6">
        <FieldGroup>
          <Field data-invalid={Boolean(fieldErrors.identifier)}>
            <FieldLabel htmlFor="identifier">{t('signIn.credentials.identifier')}</FieldLabel>
            <Input
              id="identifier"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              // Only after the person moved to this step, never on first load.
              autoFocus={autoFocus}
              className={CONTROL_CLASS}
              value={identifier}
              aria-invalid={Boolean(fieldErrors.identifier)}
              aria-describedby={describedBy('identifier', fieldErrors.identifier)}
              onChange={(event) => onIdentifierChange(event.target.value)}
            />
            <FieldError id="identifier-error">{fieldErrors.identifier}</FieldError>
          </Field>
          <Field data-invalid={Boolean(fieldErrors.password)}>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="password">{t('signIn.credentials.password')}</FieldLabel>
              <Link href="/forgot-password" className={cn(LINK_CLASS, 'text-sm')}>
                {t('signIn.credentials.forgot')}
              </Link>
            </div>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              showLabel={t('showPassword')}
              hideLabel={t('hidePassword')}
              className={CONTROL_CLASS}
              value={password}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={describedBy('password', fieldErrors.password)}
              onChange={(event) => onPasswordChange(event.target.value)}
            />
            <FieldError id="password-error">{fieldErrors.password}</FieldError>
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="keep-signed-in"
              checked={keepSignedIn}
              onCheckedChange={(checked) => onKeepSignedInChange(checked)}
              aria-labelledby="keep-signed-in-label"
              aria-describedby="keep-signed-in-hint"
              className="pointer-coarse:size-6"
            />
            <FieldContent>
              <FieldLabel id="keep-signed-in-label" htmlFor="keep-signed-in">
                {t('signIn.credentials.remember')}
              </FieldLabel>
              <FieldDescription id="keep-signed-in-hint">
                {t('signIn.credentials.rememberHint')}
              </FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>

        {formMessage ? (
          <Alert variant="destructive">
            <AlertDescription>{formMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-3">
          <Button type="submit" className={cn(BUTTON_CLASS, 'w-full')} disabled={busy}>
            {signIn.isPending ? <Spinner aria-hidden="true" /> : null}
            {signIn.isPending ? t('signIn.credentials.submitting') : t('signIn.credentials.submit')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={cn(BUTTON_CLASS, 'w-full')}
            disabled={!canEmailCode || busy}
            aria-describedby={parsedIdentifier.kind === 'mobile' ? 'code-needs-email' : undefined}
            onClick={() => void onEmailCode()}
          >
            {requestCode.isPending ? <Spinner aria-hidden="true" /> : null}
            {requestCode.isPending
              ? t('signIn.credentials.sendingCode')
              : t('signIn.credentials.emailCode')}
          </Button>
          {parsedIdentifier.kind === 'mobile' ? (
            <p id="code-needs-email" className="text-muted-foreground text-sm">
              {t('signIn.credentials.codeNeedsEmail')}
            </p>
          ) : null}
        </div>
      </form>
    </AuthCard>
  );
}
