import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';

import { VerifyResult } from '@/features/school-registration/verify-result';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/register-school/verify'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'registration.verify' });
  // The URL carries a single-use token: keep it out of indexes and Referer headers.
  return { title: t('title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/** Server render never touches the token; the client component consumes it once in an effect. */
export default async function VerifyPage({
  params,
}: PageProps<'/[locale]/register-school/verify'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <VerifyResult />
    </Suspense>
  );
}
