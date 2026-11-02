import { safeNextPath } from '@classloom/utils';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SetupTwoFactorPanel } from '@/features/setup-two-factor/setup-two-factor-panel';
import { routing } from '@/i18n/routing';
import { requireServerSession } from '@/lib/server-session';
import { isSetupPath, SETUP_SECTION } from '@/lib/setup-redirect';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/setup-two-factor'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'setupTwoFactor' });
  return { title: t('metaTitle') };
}

const single = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value : undefined;

export default async function SetupTwoFactorPage({
  params,
  searchParams,
}: PageProps<'/[locale]/setup-two-factor'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const session = await requireServerSession();
  // Anything but a same-site path in a supported locale (open redirects, loops) goes to the dashboard.
  const dashboard = `/${locale}/dashboard`;
  let nextPath = safeNextPath(single(query.next), routing.locales, dashboard);
  // Never come back to this page (a loop): the setup is done or not needed.
  if (isSetupPath(nextPath)) nextPath = dashboard;

  // Nothing to set up (done elsewhere, or the requirement was lifted): carry on.
  if (!session.twoFactorSetupRequired) redirect(nextPath);

  const selfPath = `/${locale}/${SETUP_SECTION}?next=${encodeURIComponent(nextPath)}`;
  return (
    <SetupTwoFactorPanel
      schoolCode={session.school.code}
      email={session.user.email}
      nextPath={nextPath}
      selfPath={selfPath}
    />
  );
}
