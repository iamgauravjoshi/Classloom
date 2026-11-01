'use client';

import { useRequestSignInCode, useVerifySignInCode } from '@classloom/api-client';
import { AuthCard } from '@classloom/ui/components/auth-card';
import { Button } from '@classloom/ui/components/ui/button';
import { Field, FieldError, FieldLabel } from '@classloom/ui/components/ui/field';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@classloom/ui/components/ui/input-otp';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { cn } from '@classloom/ui/lib/utils';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';

import { codeRequestErrorKey, type CodeVerifyErrorKey, codeVerifyErrorKey } from './auth-errors';
import { BUTTON_CLASS, LINK_CLASS } from './auth-ui';
import { type SentCode, sentCode } from './sent-code';
import type { TwoFactorChallenge } from './two-factor-step';
import { formatCountdown, useCountdown } from './use-countdown';

const CODE_LENGTH = 6;
/** The API stops a code after 5 wrong tries; from then on, point at a new one. */
const MAX_ATTEMPTS = 5;

interface CodeStepProps {
  logo: ReactNode;
  copyright: string;
  schoolCode: string;
  code: SentCode;
  keepSignedIn: boolean;
  onResent: (code: SentCode) => void;
  onUsePassword: () => void;
  /** The code was right but a second step is due. */
  onChallenge: (challenge: TwoFactorChallenge) => void;
  onSignedIn: () => void;
}

type CodeError = 'required' | CodeVerifyErrorKey;

/** Step 3: the emailed 6-digit code. Submits itself on the 6th digit. */
export function CodeStep({
  logo,
  copyright,
  schoolCode,
  code,
  keepSignedIn,
  onResent,
  onUsePassword,
  onChallenge,
  onSignedIn,
}: CodeStepProps) {
  const t = useTranslations('auth');
  const verify = useVerifySignInCode();
  const resend = useRequestSignInCode();
  const [value, setValue] = useState('');
  const [error, setError] = useState<CodeError | null>(null);
  const [wrongTries, setWrongTries] = useState(0);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  // Guards the 6th-digit auto-submit racing a click on Verify.
  const submitting = useRef(false);

  const expiry = useCountdown(code.expiresAt);
  const resendWait = useCountdown(code.resendAt);

  async function submit(candidate: string) {
    if (submitting.current) return;
    if (candidate.length !== CODE_LENGTH) {
      setError('required');
      return;
    }
    submitting.current = true;
    setError(null);
    try {
      const result = await verify.mutateAsync({
        data: { schoolCode, email: code.email, code: candidate, remember: keepSignedIn },
      });
      if ('twoFactorRequired' in result) {
        onChallenge({ challenge: result.challenge, expiresAt: Date.parse(result.expiresAt) });
        return;
      }
      onSignedIn();
    } catch (failure) {
      const key = codeVerifyErrorKey(failure);
      if (key === 'incorrect') setWrongTries((tries) => tries + 1);
      setError(key);
      setValue('');
      submitting.current = false;
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(value);
  }

  async function onResend() {
    if (resend.isPending || !resendWait.expired) return;
    setResendError(null);
    setResent(false);
    try {
      const { maskedEmail } = await resend.mutateAsync({
        data: { schoolCode, email: code.email },
      });
      setValue('');
      setError(null);
      setWrongTries(0);
      setResent(true);
      onResent(sentCode(schoolCode, code.email, maskedEmail));
    } catch (failure) {
      setResendError(t(`errors.${codeRequestErrorKey(failure)}`));
    }
  }

  let message: string | null = null;
  if (error === 'required') message = t('signIn.code.required');
  else if (error === 'incorrect') {
    message =
      wrongTries >= MAX_ATTEMPTS
        ? `${t('signIn.code.incorrect')} ${t('signIn.code.requestNew')}.`
        : t('signIn.code.incorrect');
  } else if (error) message = t(`errors.${error}`);

  return (
    <AuthCard
      logo={logo}
      copyright={copyright}
      title={t('signIn.code.title')}
      description={t.rich('signIn.code.sent', {
        email: code.maskedEmail,
        strong: (chunks) => <strong className="text-foreground font-semibold">{chunks}</strong>,
      })}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <Field data-invalid={Boolean(message)}>
          <FieldLabel htmlFor="sign-in-code">{t('signIn.code.label')}</FieldLabel>
          <InputOTP
            id="sign-in-code"
            name="code"
            maxLength={CODE_LENGTH}
            value={value}
            // Focus lands here when the step opens: the person just asked for this code.
            autoFocus
            aria-invalid={Boolean(message)}
            aria-describedby={message ? 'sign-in-code-error' : undefined}
            onChange={(next) => {
              setValue(next);
              if (error) setError(null);
            }}
            onComplete={(complete: string) => void submit(complete)}
          >
            <InputOTPGroup>
              {Array.from({ length: CODE_LENGTH }, (_, index) => (
                <InputOTPSlot key={index} index={index} />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <FieldError id="sign-in-code-error">{message}</FieldError>
          <div className="text-sm">
            {/* Read by sight only; screen readers hear just the expiry, from the live region. */}
            {expiry.expired ? null : (
              <p className="text-muted-foreground tabular-nums" aria-hidden="true">
                {t('signIn.code.expiresIn', { time: formatCountdown(expiry.secondsLeft) })}
              </p>
            )}
            <p aria-live="polite" className="font-medium">
              {expiry.expired ? t('signIn.code.expired') : null}
            </p>
          </div>
        </Field>

        <Button type="submit" className={cn(BUTTON_CLASS, 'w-full')} disabled={verify.isPending}>
          {verify.isPending ? <Spinner aria-hidden="true" /> : null}
          {verify.isPending ? t('signIn.code.verifying') : t('signIn.code.verify')}
        </Button>

        <div className="flex flex-col items-start gap-2 text-sm">
          <button
            type="button"
            className={cn(
              LINK_CLASS,
              'cursor-pointer disabled:cursor-not-allowed disabled:opacity-60',
            )}
            disabled={!resendWait.expired || resend.isPending}
            aria-describedby={resendWait.expired ? undefined : 'resend-wait'}
            onClick={() => void onResend()}
          >
            {resend.isPending ? t('signIn.code.resending') : t('signIn.code.resend')}
          </button>
          {resendWait.expired ? null : (
            <p id="resend-wait" className="text-muted-foreground tabular-nums">
              {t('signIn.code.resendIn', { seconds: resendWait.secondsLeft })}
            </p>
          )}
          {resent ? <p role="status">{t('signIn.code.resent')}</p> : null}
          {resendError ? (
            <p role="alert" className="text-danger-strong">
              {resendError}
            </p>
          ) : null}
          <button
            type="button"
            className={cn(LINK_CLASS, 'cursor-pointer')}
            onClick={onUsePassword}
          >
            {t('signIn.code.usePassword')}
          </button>
        </div>
      </form>
    </AuthCard>
  );
}
