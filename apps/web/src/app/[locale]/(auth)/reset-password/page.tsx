import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';

import { ResetPasswordForm } from '@/features/auth/reset-password-form';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/reset-password'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.reset' });
  // The URL carries a single-use token: keep it out of indexes and Referer headers.
  return {
    title: t('metaTitle'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

/** The server render never reads the token; the form takes it from the address bar on load. */
export default async function ResetPasswordPage({ params }: PageProps<'/[locale]/reset-password'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
