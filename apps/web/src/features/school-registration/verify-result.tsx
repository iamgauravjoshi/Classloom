'use client';

import {
  ApiError,
  useResendSchoolRegistration,
  verifySchoolRegistration,
} from '@classloom/api-client';
import { resendRegistrationRequestSchema } from '@classloom/contracts';
import { Alert, AlertDescription, AlertTitle } from '@classloom/ui/components/ui/alert';
import { Button, buttonVariants } from '@classloom/ui/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@classloom/ui/components/ui/field';
import { Input } from '@classloom/ui/components/ui/input';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { cn } from '@classloom/ui/lib/utils';
import { IconAlertTriangle, IconCircleCheck, IconCopy, IconLinkOff } from '@tabler/icons-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { Link } from '@/i18n/navigation';

import { BUTTON_CLASS, CONTROL_CLASS } from './form-types';

type State =
  | { kind: 'loading' }
  | { kind: 'success'; code: string; name: string }
  | { kind: 'invalid' }
  | { kind: 'error' };

/**
 * Consumes the single-use token from `?token=` exactly once, in an effect (never during render, so a
 * server render or prefetch cannot burn it), then drops it from the address bar.
 */
export function VerifyResult() {
  const searchParams = useSearchParams();
  // Captured on first render, before the effect removes it from the address bar.
  const [initialToken] = useState(() => searchParams.get('token'));
  const [state, setState] = useState<State>(
    initialToken ? { kind: 'loading' } : { kind: 'invalid' },
  );
  const started = useRef(false);

  const run = useCallback(async (token: string) => {
    try {
      const result = await verifySchoolRegistration({ token });
      setState({ kind: 'success', code: result.code, name: result.name });
    } catch (error) {
      // 410 is the API's single answer for expired, used and unknown; 400 is a malformed token.
      const invalid = error instanceof ApiError && (error.status === 410 || error.status === 400);
      setState({ kind: invalid ? 'invalid' : 'error' });
    }
  }, []);

  useEffect(() => {
    // The ref survives React Strict Mode's double effect, so the token is posted once.
    if (!initialToken || started.current) return;
    started.current = true;
    window.history.replaceState(window.history.state, '', window.location.pathname);
    void run(initialToken);
  }, [initialToken, run]);

  const retry = useCallback(() => {
    if (!initialToken) return;
    setState({ kind: 'loading' });
    void run(initialToken);
  }, [initialToken, run]);

  return (
    <div aria-live="polite">
      {state.kind === 'loading' ? <Loading /> : null}
      {state.kind === 'success' ? <Success code={state.code} name={state.name} /> : null}
      {state.kind === 'invalid' ? <Invalid /> : null}
      {state.kind === 'error' ? <NetworkError onRetry={retry} /> : null}
    </div>
  );
}

function Loading() {
  const t = useTranslations('registration.verify');
  return (
    <p className="text-muted-foreground flex items-center gap-2" role="status">
      <Spinner aria-hidden="true" />
      {t('loading')}
    </p>
  );
}

function Success({ code, name }: { code: string; name: string }) {
  const t = useTranslations('registration.verify');
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  }

  return (
    <section className="flex flex-col items-start gap-5">
      <span className="bg-success-tint text-success-strong flex size-12 items-center justify-center rounded-full">
        <IconCircleCheck size={26} aria-hidden="true" />
      </span>
      <h1 className="text-h3">{t('ready', { name })}</h1>
      <div className="bg-card flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-sm">{t('codeLabel')}</span>
          <strong className="font-mono text-2xl tracking-wide">{code}</strong>
        </div>
        <Button
          type="button"
          variant="outline"
          className={BUTTON_CLASS}
          onClick={() => void onCopy()}
        >
          <IconCopy aria-hidden="true" />
          {t('copy')}
        </Button>
      </div>
      <p className="text-muted-foreground text-sm" role="status">
        {copy === 'copied' ? t('copied') : null}
        {copy === 'failed' ? t('copyFailed') : null}
      </p>
      <p className="text-muted-foreground text-sm">{t('next')}</p>
    </section>
  );
}

function Invalid() {
  const t = useTranslations('registration.verify');
  const tErrors = useTranslations('registration.errors');
  const resend = useResendSchoolRegistration();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{ email?: string; code?: string }>({});
  const [outcome, setOutcome] = useState<'sent' | 'error' | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setOutcome(null);
    const parsed = resendRegistrationRequestSchema.safeParse({ email, code });
    if (!parsed.success) {
      const next: { email?: string; code?: string } = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'email') next.email = tErrors('email');
        if (issue.path[0] === 'code') next.code = tErrors('code');
      }
      setErrors(next);
      return;
    }
    setErrors({});
    try {
      await resend.mutateAsync({ data: parsed.data });
      setOutcome('sent');
    } catch (error) {
      setOutcome(error instanceof ApiError && error.status === 429 ? 'sent' : 'error');
    }
  }

  return (
    <section className="flex flex-col items-start gap-5">
      <span className="bg-warning-tint text-warning-strong flex size-12 items-center justify-center rounded-full">
        <IconLinkOff size={26} aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-h3">{t('invalidTitle')}</h1>
        <p className="text-muted-foreground">{t('invalidBody')}</p>
      </div>

      <form
        onSubmit={(event) => void onSubmit(event)}
        noValidate
        className="flex w-full flex-col gap-4"
      >
        <h2 className="text-h5">{t('requestTitle')}</h2>
        <FieldGroup>
          <Field data-invalid={Boolean(errors.email)}>
            <FieldLabel htmlFor="resend-email">{t('email')}</FieldLabel>
            <Input
              id="resend-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              className={CONTROL_CLASS}
              value={email}
              aria-invalid={Boolean(errors.email)}
              onChange={(event) => setEmail(event.target.value)}
            />
            <FieldError>{errors.email}</FieldError>
          </Field>
          <Field data-invalid={Boolean(errors.code)}>
            <FieldLabel htmlFor="resend-code">{t('code')}</FieldLabel>
            <Input
              id="resend-code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className={cn(CONTROL_CLASS, 'font-mono tracking-wide uppercase')}
              value={code}
              aria-invalid={Boolean(errors.code)}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
            <FieldError>{errors.code}</FieldError>
          </Field>
        </FieldGroup>
        <Button
          type="submit"
          className={cn(BUTTON_CLASS, 'self-start')}
          disabled={resend.isPending}
        >
          {resend.isPending ? <Spinner aria-hidden="true" /> : null}
          {resend.isPending ? t('sending') : t('send')}
        </Button>
      </form>

      {outcome === 'sent' ? (
        <Alert>
          <AlertDescription>{t('sent')}</AlertDescription>
        </Alert>
      ) : null}
      {outcome === 'error' ? (
        <Alert variant="destructive">
          <AlertDescription>{tErrors('generic')}</AlertDescription>
        </Alert>
      ) : null}

      <Link
        href="/register-school"
        className={cn(buttonVariants({ variant: 'link' }), 'text-primary-text h-auto p-0')}
      >
        {t('register')}
      </Link>
    </section>
  );
}

function NetworkError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('registration.verify');
  return (
    <Alert variant="destructive" className="flex flex-col items-start gap-3 p-4">
      <IconAlertTriangle aria-hidden="true" />
      <AlertTitle>{t('errorTitle')}</AlertTitle>
      <AlertDescription>{t('errorBody')}</AlertDescription>
      <Button type="button" className={BUTTON_CLASS} onClick={onRetry}>
        {t('retry')}
      </Button>
    </Alert>
  );
}
