import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RegistrationForm } from '@/features/school-registration/registration-form';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/register-school'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'registration.header' });
  return { title: t('title') };
}

export default async function RegisterSchoolPage({
  params,
}: PageProps<'/[locale]/register-school'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <RegistrationForm />;
}
