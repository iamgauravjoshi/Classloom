'use client';

import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button } from '@classloom/ui/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@classloom/ui/components/ui/card';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useState } from 'react';

import { reauthPath } from '../account/recent-sign-in';
import { formatDateTime, formatDay } from './format';
import type { SecurityError } from './security-errors';

/** A Security page section: a card with an `h2`, an optional action and its content. */
export function SectionCard({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card aria-labelledby={`${id}-title`} role="region">
      <CardHeader>
        <CardTitle
          id={`${id}-title`}
          role="heading"
          aria-level={2}
          tabIndex={-1}
          className="text-h5 outline-none"
        >
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="pb-6">{children}</CardContent>
    </Card>
  );
}

/** The loading line, or the error with "Try again", while a section's list is not there yet. */
export function LoadState({ isError, onRetry }: { isError: boolean; onRetry: () => void }) {
  const t = useTranslations('account.security');
  if (isError) {
    return (
      <Alert variant="destructive" className="flex flex-col items-start gap-3">
        <AlertDescription>{t('loadFailed')}</AlertDescription>
        <Button variant="outline" className="h-10 px-4 pointer-coarse:h-11" onClick={onRetry}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }
  return (
    <p className="text-muted-foreground flex items-center gap-2" role="status">
      <Spinner aria-hidden="true" />
      {t('loading')}
    </p>
  );
}

/** Dates in the app's time zone, written "2 Nov 2026" (with the time for `dateTime`). */
export function useSecurityDates() {
  const timeZone = useTimeZone() ?? 'Asia/Kolkata';
  return {
    day: (iso: string) => formatDay(iso, timeZone),
    dateTime: (iso: string) => formatDateTime(iso, timeZone),
  };
}

/** Copies text, telling the person whether it worked. */
export function useCopy() {
  const t = useTranslations('account.security');
  return useCallback(
    async (text: string, done: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.add({ title: done, type: 'success' });
      } catch {
        toast.add({ title: t('copyFailed'), type: 'error' });
      }
    },
    [t],
  );
}

/**
 * Sends the person through Part 2a's email-code sign-in again (a recent sign-in), back to this
 * page afterwards. `redirecting` stays true until the browser leaves.
 */
export function useReauth(schoolCode: string) {
  const locale = useLocale();
  const [redirecting, setRedirecting] = useState(false);
  const reauth = useCallback(() => {
    setRedirecting(true);
    window.location.assign(reauthPath(locale, schoolCode, `/${locale}/account/security`));
  }, [locale, schoolCode]);
  return { redirecting, reauth };
}

/** The sentence for an action's failure (not a wrong code, which lands on its field). */
export function useErrorText() {
  const t = useTranslations('account.security');
  const tAuth = useTranslations('auth');
  return useCallback(
    (error: SecurityError): string => {
      switch (error.kind) {
        case 'paused':
          return t('errors.paused');
        case 'wrongCode':
          return t('errors.wrongCode');
        case 'stale':
          return t('errors.stale');
        case 'setupExpired':
          return t('setup.expired');
        case 'recentSignIn':
          return t('redirecting');
        case 'error':
          return tAuth(`errors.${error.key}`);
      }
    },
    [t, tAuth],
  );
}
