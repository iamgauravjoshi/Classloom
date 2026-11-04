import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AccessDenied } from '@/components/access-denied';
import { AppPageHeader } from '@/components/app-page-header';
import { OnboardingWizard } from '@/features/onboarding/onboarding-wizard';
import { isWizardStep } from '@/features/onboarding/wizard-step-keys';
import { canOpenSection } from '@/lib/page-access';
import { requireServerSession } from '@/lib/server-session';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/onboarding'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'onboarding' });
  return { title: t('metaTitle') };
}

/** The setup wizard (spec §9). Only people who manage settings may open it. */
export default async function OnboardingPage({
  params,
  searchParams,
}: PageProps<'/[locale]/onboarding'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('onboarding');
  const session = await requireServerSession();
  if (!session.permissions.includes('settings.manage')) {
    return (
      <AccessDenied
        title={t('title')}
        canOpenDashboard={canOpenSection('dashboard', session.permissions)}
      />
    );
  }
  const { step } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader title={t('title')} breadcrumbs={[{ label: t('title') }]} />
      <p className="text-muted-foreground -mt-3">{t('description')}</p>
      <OnboardingWizard initialStep={isWizardStep(step) ? step : 'profile'} />
    </div>
  );
}
