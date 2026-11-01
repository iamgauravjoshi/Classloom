'use client';

import { useVerifyTwoFactor } from '@classloom/api-client';
import { AuthCard } from '@classloom/ui/components/auth-card';
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
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@classloom/ui/components/ui/input-otp';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { cn } from '@classloom/ui/lib/utils';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';

import { BUTTON_CLASS, CONTROL_CLASS, LINK_CLASS } from './auth-ui';
import { type TwoFactorError, twoFactorErrorOf } from './two-factor-errors';
import { formatCountdown, useCountdown } from './use-countdown';

const CODE_LENGTH = 6;

/** A sign-in waiting for its second step: the token from the 202 and when it stops working. */
export interface TwoFactorChallenge {
  challenge: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

interface TwoFactorStepProps {
  logo: ReactNode;
  copyright: string;
  challenge: TwoFactorChallenge;
  onStartAgain: () => void;
  onSignedIn: () => void;
}

type StepError = 'required' | TwoFactorError;

/** Step 4: the authenticator app code (or a recovery code). Submits itself on the 6th digit. */
export function TwoFactorStep({
  logo,
  copyright,
  challenge,
  onStartAgain,
  onSignedIn,
}: TwoFactorStepProps) {
  const t = useTranslations('auth');
  const verify = useVerifyTwoFactor();
  const [recovery, setRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [recoveryValue, setRecoveryValue] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<StepError | null>(null);
  // The API dropped the challenge (5 wrong tries, or it was refused): only "Start again" is left.
  const [gone, setGone] = useState(false);
  // Guards the 6th-digit auto-submit racing a click on Verify.
  const submitting = useRef(false);

  const expiry = useCountdown(challenge.expiresAt);
  const ended = expiry.expired || gone;

  async function submit(candidate: string) {
    if (submitting.current || ended) return;
    const entered = recovery ? candidate.trim() : candidate.replace(/\s/g, '');
    if (recovery ? entered === '' : entered.length !== CODE_LENGTH) {
      setError('required');
      return;
    }
    submitting.current = true;
    setError(null);
    try {
      await verify.mutateAsync({
        data: {
          challenge: challenge.challenge,
          ...(recovery ? { recoveryCode: entered } : { code: entered }),
          trustDevice,
        },
      });
      onSignedIn();
    } catch (failure) {
      const next = twoFactorErrorOf(failure);
      if (next.key === 'expired' || (next.key === 'invalid' && next.attemptsLeft === 0)) {
        setGone(true);
      }
      setError(next);
      setValue('');
      setRecoveryValue('');
      submitting.current = false;
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(recovery ? recoveryValue : value);
  }

  function toggleRecovery() {
    setRecovery(!recovery);
    setError(null);
    setValue('');
    setRecoveryValue('');
  }

  // What the person is told: under the field, or, once the sign-in has ended, in an alert.
  let message: string | null = null;
  if (ended) message = t('signIn.twoFactor.expired');
  else if (error === 'required') {
    message = recovery ? t('signIn.twoFactor.recoveryRequired') : t('signIn.twoFactor.required');
  } else if (error) {
    switch (error.key) {
      case 'invalid':
        message =
          error.attemptsLeft === undefined
            ? t('signIn.twoFactor.invalid')
            : `${t('signIn.twoFactor.invalid')} ${t('signIn.twoFactor.triesLeft', { count: error.attemptsLeft })}`;
        break;
      case 'paused':
        message = t('signIn.twoFactor.paused');
        break;
      case 'expired':
        message = t('signIn.twoFactor.expired');
        break;
      default:
        message = t(`errors.${error.key}`);
    }
  }
  const fieldMessage = !ended && message ? message : null;

  const fieldId = recovery ? 'two-factor-recovery' : 'two-factor-code';

  return (
    <AuthCard
      logo={logo}
      copyright={copyright}
      title={t('signIn.twoFactor.title')}
      description={
        recovery ? t('signIn.twoFactor.recoveryDescription') : t('signIn.twoFactor.description')
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        {ended ? (
          <Alert variant="destructive">
            <AlertDescription role="alert">{message}</AlertDescription>
          </Alert>
        ) : (
          <FieldGroup>
            <Field data-invalid={Boolean(fieldMessage)}>
              <FieldLabel htmlFor={fieldId}>
                {recovery ? t('signIn.twoFactor.recoveryLabel') : t('signIn.twoFactor.label')}
              </FieldLabel>
              {recovery ? (
                <Input
                  id={fieldId}
                  name="recovery-code"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  autoFocus
                  placeholder="XXXXX-XXXXX"
                  className={cn(CONTROL_CLASS, 'font-mono')}
                  value={recoveryValue}
                  aria-invalid={Boolean(fieldMessage)}
                  aria-describedby={fieldMessage ? `${fieldId}-error` : undefined}
                  onChange={(event) => {
                    setRecoveryValue(event.target.value);
                    if (error) setError(null);
                  }}
                />
              ) : (
                <InputOTP
                  id={fieldId}
                  name="code"
                  maxLength={CODE_LENGTH}
                  value={value}
                  autoFocus
                  aria-invalid={Boolean(fieldMessage)}
                  aria-describedby={fieldMessage ? `${fieldId}-error` : undefined}
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
              )}
              <FieldError id={`${fieldId}-error`}>{fieldMessage}</FieldError>
              {/* Read by sight only; a screen reader hears the expiry from the alert. */}
              <p className="text-muted-foreground text-sm tabular-nums" aria-hidden="true">
                {t('signIn.twoFactor.expiresIn', { time: formatCountdown(expiry.secondsLeft) })}
              </p>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="trust-device"
                checked={trustDevice}
                onCheckedChange={(checked) => setTrustDevice(checked)}
                aria-labelledby="trust-device-label"
                aria-describedby="trust-device-hint"
                className="pointer-coarse:size-6"
              />
              <FieldContent>
                <FieldLabel id="trust-device-label" htmlFor="trust-device">
                  {t('signIn.twoFactor.trust')}
                </FieldLabel>
                <FieldDescription id="trust-device-hint">
                  {t('signIn.twoFactor.trustHint')}
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>
        )}

        {ended ? null : (
          <Button type="submit" className={cn(BUTTON_CLASS, 'w-full')} disabled={verify.isPending}>
            {verify.isPending ? <Spinner aria-hidden="true" /> : null}
            {verify.isPending ? t('signIn.twoFactor.verifying') : t('signIn.twoFactor.verify')}
          </Button>
        )}

        <div className="flex flex-col items-start gap-2 text-sm">
          {ended ? null : (
            <button
              type="button"
              className={cn(LINK_CLASS, 'cursor-pointer')}
              onClick={toggleRecovery}
            >
              {recovery ? t('signIn.twoFactor.useApp') : t('signIn.twoFactor.useRecovery')}
            </button>
          )}
          <button type="button" className={cn(LINK_CLASS, 'cursor-pointer')} onClick={onStartAgain}>
            {t('signIn.twoFactor.startAgain')}
          </button>
        </div>
      </form>
    </AuthCard>
  );
}
