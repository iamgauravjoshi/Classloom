import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AppPageHeader } from '@/components/app-page-header';
import { AccountTabs } from '@/features/account/account-tabs';
import { SecurityContent } from '@/features/security/security-content';
import { requireServerSession } from '@/lib/server-session';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/account/security'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account.security' });
  return { title: t('metaTitle') };
}

export default async function SecurityPage({ params }: PageProps<'/[locale]/account/security'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('account');
  const session = await requireServerSession();

  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader
        title={t('title')}
        breadcrumbs={[{ label: t('title'), href: '/account' }, { label: t('security.title') }]}
      />
      <AccountTabs current="security" />
      <SecurityContent schoolCode={session.school.code} />
    </div>
  );
}
