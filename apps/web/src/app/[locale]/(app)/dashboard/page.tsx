import { StatCard } from '@classloom/ui/components/stat-card';
import { Card, CardDescription, CardHeader, CardTitle } from '@classloom/ui/components/ui/card';
import { formatDateIN } from '@classloom/utils';
import { IconBook, IconSchool, IconUsers, IconUserShield } from '@tabler/icons-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AppPageHeader } from '@/components/app-page-header';
import { ApiStatus } from '@/components/shell/api-status';
import { getMockSession } from '@/lib/mock-session';

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
  const session = getMockSession();
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
            {t('today', { date: formatDateIN(new Date()), year: session.academicYear })}
          </CardDescription>
        </CardHeader>
      </Card>
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
