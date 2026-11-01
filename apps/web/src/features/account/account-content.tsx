'use client';

import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button } from '@classloom/ui/components/ui/button';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { useTranslations } from 'next-intl';

import { PasswordForm } from './password-form';
import { ProfileForm } from './profile-form';
import { useMe } from './use-me';

/** The page's two sections, once `GET /me` has answered. */
export function AccountContent({ schoolCode }: { schoolCode: string }) {
  const t = useTranslations('account');
  const { data: me, isPending, isError, refetch } = useMe();

  if (isPending) {
    return (
      <p className="text-muted-foreground flex items-center gap-2" role="status">
        <Spinner aria-hidden="true" />
        {t('loading')}
      </p>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive" className="flex flex-col items-start gap-3">
        <AlertDescription>{t('loadFailed')}</AlertDescription>
        <Button variant="outline" onClick={() => void refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ProfileForm me={me} />
      <PasswordForm me={me} schoolCode={schoolCode} />
    </div>
  );
}
