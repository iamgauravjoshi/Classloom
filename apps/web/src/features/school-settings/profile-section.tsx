'use client';

import { useGetSchoolProfile } from '@classloom/api-client';
import type { SchoolProfile } from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button } from '@classloom/ui/components/ui/button';
import { Card, CardContent } from '@classloom/ui/components/ui/card';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { useTranslations } from 'next-intl';

import { BUTTON_CLASS } from '../auth/auth-ui';
import { LogoField } from './logo-field';
import { ProfileForm } from './profile-form';

/** The Settings page body: the logo and the profile, once `GET /school/profile` has answered. */
export function ProfileSection({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('schoolSettings.profile');
  const { data, isPending, isError, refetch } = useGetSchoolProfile();

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
        <AlertDescription>{t('loadError')}</AlertDescription>
        <Button variant="outline" className={BUTTON_CLASS} onClick={() => void refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }

  // The generated DTO and the contract describe the same response.
  const profile: SchoolProfile = data;
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="py-6">
          <LogoField logoUrl={profile.logoUrl} canEdit={canEdit} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-6">
          <ProfileForm profile={profile} canEdit={canEdit} />
        </CardContent>
      </Card>
    </div>
  );
}
