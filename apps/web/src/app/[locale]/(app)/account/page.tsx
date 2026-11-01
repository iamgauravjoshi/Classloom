import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AppPageHeader } from '@/components/app-page-header';
import { AccountContent } from '@/features/account/account-content';
import { AccountTabs } from '@/features/account/account-tabs';
import { requireServerSession } from '@/lib/server-session';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/account'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t('metaTitle') };
}

export default async function AccountPage({ params }: PageProps<'/[locale]/account'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('account');
  const session = await requireServerSession();

  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader title={t('title')} breadcrumbs={[{ label: t('title') }]} />
      <AccountTabs current="profile" />
      <AccountContent schoolCode={session.school.code} />
    </div>
  );
}
