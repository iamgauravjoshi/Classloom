'use client';

import { ApiError, useResendSchoolRegistration } from '@classloom/api-client';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button } from '@classloom/ui/components/ui/button';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { IconMailCheck } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { BUTTON_CLASS } from './form-types';

export const RESEND_COOLDOWN_SECONDS = 60;

interface CheckInboxProps {
  maskedEmail: string;
  /** Needed for the resend call; never rendered. */
  email: string;
  code: string;
  /** True while the pending registration is being withdrawn. */
  changingEmail: boolean;
  changeEmailFailed: boolean;
  onChangeEmail: () => void;
}

export function CheckInbox({
  maskedEmail,
  email,
  code,
  changingEmail,
  changeEmailFailed,
  onChangeEmail,
}: CheckInboxProps) {
  const t = useTranslations('registration.checkInbox');
  const resend = useResendSchoolRegistration();
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN_SECONDS);
  const [notice, setNotice] = useState<'sent' | 'error' | null>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  async function onResend() {
    setNotice(null);
    try {
      await resend.mutateAsync({ data: { email, code } });
      setNotice('sent');
    } catch (error) {
      // 429 still starts a cooldown; anything else is reported.
      setNotice(error instanceof ApiError && error.status === 429 ? 'sent' : 'error');
    }
    setSecondsLeft(RESEND_COOLDOWN_SECONDS);
  }

  const waiting = secondsLeft > 0;

  return (
    <section className="flex flex-col items-start gap-5" aria-labelledby="check-inbox-title">
      <span className="bg-primary-tint text-primary-strong flex size-12 items-center justify-center rounded-full">
        <IconMailCheck size={26} aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 id="check-inbox-title" className="text-h3">
          {t('title')}
        </h1>
        <p>{t('body', { email: maskedEmail })}</p>
        <p className="text-muted-foreground text-sm">{t('spam')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          className={BUTTON_CLASS}
          disabled={waiting || resend.isPending}
          onClick={() => void onResend()}
        >
          {resend.isPending ? <Spinner aria-hidden="true" /> : null}
          {t('resend')}
        </Button>
        <p className="text-muted-foreground text-sm">
          {waiting ? t('resendIn', { seconds: secondsLeft }) : t('resendReady')}
        </p>
      </div>

      {notice === 'sent' ? (
        <Alert>
          <AlertDescription>{t('resent')}</AlertDescription>
        </Alert>
      ) : null}
      {notice === 'error' ? (
        <Alert variant="destructive">
          <AlertDescription>{t('resendError')}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="button"
        variant="link"
        className="text-primary-text h-auto p-0"
        disabled={changingEmail}
        onClick={onChangeEmail}
      >
        {changingEmail ? <Spinner aria-hidden="true" /> : null}
        {t('differentEmail')}
      </Button>
      {changeEmailFailed ? (
        <Alert variant="destructive">
          <AlertDescription>{t('differentEmailError')}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
