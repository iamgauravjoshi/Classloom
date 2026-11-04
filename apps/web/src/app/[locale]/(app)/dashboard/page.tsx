import type { AcademicYearsResponseDto, OnboardingResponseDto } from '@classloom/api-client';
import { StatCard } from '@classloom/ui/components/stat-card';
import { Card, CardDescription, CardHeader, CardTitle } from '@classloom/ui/components/ui/card';
import { formatDateIN } from '@classloom/utils';
import { IconBook, IconSchool, IconUsers, IconUserShield } from '@tabler/icons-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AccessDenied } from '@/components/access-denied';
import { AppPageHeader } from '@/components/app-page-header';
import { ApiStatus } from '@/components/shell/api-status';
import { ChecklistCard } from '@/features/onboarding/checklist-card';
import { shouldOpenWizard } from '@/lib/onboarding-redirect';
import { canOpenSection } from '@/lib/page-access';
import { requireServerSession, serverApiGet } from '@/lib/server-session';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/dashboard'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return { title: t('title') };
}

export default async function DashboardPage({ params }: PageProps<'/[locale]/dashboard'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('dashboard');
  const session = await requireServerSession();
  // `dashboard.view` comes from the navigation config, like every other page's permission.
  if (!canOpenSection('dashboard', session.permissions)) {
    return <AccessDenied title={t('title')} canOpenDashboard={false} />;
  }
  const canManage = session.permissions.includes('settings.manage');
  // A session still limited to two-step setup is sent there by the layout; nothing to read here.
  const [onboarding, years] = session.twoFactorSetupRequired
    ? [null, null]
    : await Promise.all([
        serverApiGet<OnboardingResponseDto>('/school/onboarding'),
        serverApiGet<AcademicYearsResponseDto>('/school/academic-years'),
      ]);
  // The first visit of someone who manages settings opens the setup wizard, once per school.
  if (onboarding && shouldOpenWizard({ canManage, startedAt: onboarding.startedAt })) {
    redirect(`/${locale}/onboarding`);
  }
  const currentYear = years?.years.find((year) => year.status === 'CURRENT');
  const today = formatDateIN(new Date());
  const empty = t('notAvailable');

  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader
        title={t('title')}
        breadcrumbs={[{ label: t('title') }]}
        actions={<ApiStatus />}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-h4">{t('welcome', { name: session.user.name })}</CardTitle>
          <CardDescription>
            {currentYear
              ? t('today', { date: today, year: currentYear.label })
              : t('todayNoYear', { date: today })}
          </CardDescription>
        </CardHeader>
      </Card>
      {onboarding?.visible ? <ChecklistCard initial={onboarding} /> : null}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('stats.students')} value={empty} tone="orange" icon={IconSchool} />
        <StatCard label={t('stats.teachers')} value={empty} tone="primary" icon={IconUsers} />
        <StatCard label={t('stats.staff')} value={empty} tone="warning" icon={IconUserShield} />
        <StatCard label={t('stats.subjects')} value={empty} tone="success" icon={IconBook} />
      </section>
      <p className="text-muted-foreground text-sm">{t('placeholderNote')}</p>
    </div>
  );
}
