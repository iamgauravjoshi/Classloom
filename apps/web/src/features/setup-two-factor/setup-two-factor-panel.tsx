'use client';

import { useSignOut } from '@classloom/api-client';
import { AuthCard } from '@classloom/ui/components/auth-card';
import { Button } from '@classloom/ui/components/ui/button';
import { toast } from '@classloom/ui/components/ui/toast';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { useRouter } from '@/i18n/navigation';
import { leavesAfterSignOut } from '@/lib/sign-out';

import { reauthPath } from '../account/recent-sign-in';
import { AuthLogo, BUTTON_CLASS } from '../auth/auth-ui';
import { TwoFactorSetupFlow } from '../security/two-factor-setup-flow';

interface SetupTwoFactorPanelProps {
  schoolCode: string;
  email: string;
  /** Where to go once two-step is on, already checked by `safeNextPath`. */
  nextPath: string;
  /** This page's own location, to come back to after signing in again. */
  selfPath: string;
}

/**
 * The required two-step page: why, then Part 2b's setup flow as a page section, then on to the
 * page asked for. There is deliberately no way to skip it or to turn the requirement off here.
 */
export function SetupTwoFactorPanel({
  schoolCode,
  email,
  nextPath,
  selfPath,
}: SetupTwoFactorPanelProps) {
  const t = useTranslations('setupTwoFactor');
  const tAccount = useTranslations('account.security');
  const tShell = useTranslations('shell');
  const tAuth = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [leaving, setLeaving] = useState(false);
  const signOut = useSignOut({
    mutation: {
      onSettled: (_data, error) => {
        if (leavesAfterSignOut(error)) {
          queryClient.clear();
          router.replace('/sign-in');
        } else {
          toast.add({ title: tShell('signOutFailed'), type: 'error' });
        }
      },
    },
  });

  // Setup and enable need a sign-in from the last 10 minutes (an old remembered session has none):
  // sign in again by emailed code and come back to this page.
  const onReauth = useCallback(() => {
    window.location.assign(reauthPath(locale, schoolCode, selfPath));
  }, [locale, schoolCode, selfPath]);

  // A full load: the layout reads the session again, and the cleared flag lets the page open.
  const finish = useCallback(() => {
    setLeaving(true);
    window.location.assign(nextPath);
  }, [nextPath]);

  return (
    <AuthCard
      logo={<AuthLogo />}
      copyright={tAuth('copyright')}
      title={t('title')}
      description={
        <>
          <span className="text-foreground block font-medium">{t('reason')}</span>
          {t('explain')}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {leaving ? (
          <p role="status" className="text-muted-foreground text-sm">
            {tAccount('redirecting')}
          </p>
        ) : (
          <TwoFactorSetupFlow
            email={email}
            surface="page"
            onReauth={onReauth}
            onAlreadyOn={finish}
            onDone={finish}
          />
        )}
      </div>
      <div>
        <Button
          variant="outline"
          className={BUTTON_CLASS}
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
        >
          {signOut.isPending ? t('signingOut') : t('signOut')}
        </Button>
      </div>
    </AuthCard>
  );
}
