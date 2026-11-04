import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AccessDenied } from '@/components/access-denied';
import { AppPageHeader } from '@/components/app-page-header';
import { ProfileSection } from '@/features/school-settings/profile-section';
import { canOpenSection } from '@/lib/page-access';
import { requireServerSession } from '@/lib/server-session';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/settings/school-profile'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'schoolSettings.profile' });
  return { title: t('metaTitle') };
}

export default async function SchoolProfilePage({
  params,
}: PageProps<'/[locale]/settings/school-profile'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('schoolSettings');
  const session = await requireServerSession();
  // `settings.view` comes from the navigation config, like every other page's permission.
  if (!canOpenSection('settings/school-profile', session.permissions)) {
    return (
      <AccessDenied
        title={t('profile.title')}
        canOpenDashboard={canOpenSection('dashboard', session.permissions)}
      />
    );
  }
  const canEdit = session.permissions.includes('settings.manage');

  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader title={t('profile.title')} breadcrumbs={[{ label: t('profile.title') }]} />
      <p className="text-muted-foreground -mt-3">{t('profile.description')}</p>
      <ProfileSection canEdit={canEdit} />
    </div>
  );
}
