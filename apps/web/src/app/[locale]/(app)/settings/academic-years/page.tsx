import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AccessDenied } from '@/components/access-denied';
import { AppPageHeader } from '@/components/app-page-header';
import { YearsSection } from '@/features/school-settings/years-list';
import { canOpenSection } from '@/lib/page-access';
import { requireServerSession } from '@/lib/server-session';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/settings/academic-years'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'schoolSettings.academicYears' });
  return { title: t('metaTitle') };
}

export default async function AcademicYearsPage({
  params,
}: PageProps<'/[locale]/settings/academic-years'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('schoolSettings.academicYears');
  const session = await requireServerSession();
  // `settings.view` comes from the navigation config, like every other page's permission.
  if (!canOpenSection('settings/academic-years', session.permissions)) {
    return (
      <AccessDenied
        title={t('title')}
        canOpenDashboard={canOpenSection('dashboard', session.permissions)}
      />
    );
  }
  const canEdit = session.permissions.includes('settings.manage');

  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader title={t('title')} breadcrumbs={[{ label: t('title') }]} />
      <p className="text-muted-foreground -mt-3">{t('description')}</p>
      <YearsSection canEdit={canEdit} />
    </div>
  );
}
