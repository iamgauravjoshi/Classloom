import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';

import { JoinFlow } from '@/features/join/join-flow';
import { getServerSession } from '@/lib/server-session';

export async function generateMetadata({ params }: PageProps<'/[locale]/join'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.join' });
  // The URL carries a single-use token: keep it out of indexes and Referer headers.
  return {
    title: t('metaTitle'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

/**
 * No render spends the token: the flow keeps it in memory, strips it from the address bar on load,
 * previews it, and posts it only when the person presses Join. The page reads who is signed in
 * here (if anyone) so an invitation for someone else can offer "Sign out and join".
 */
export default async function JoinPage({ params }: PageProps<'/[locale]/join'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  let signedInEmail: string | null = null;
  try {
    signedInEmail = (await getServerSession())?.user.email ?? null;
  } catch {
    // The API is unreachable: the preview will report the problem.
  }
  return (
    <Suspense>
      <JoinFlow signedInEmail={signedInEmail} />
    </Suspense>
  );
}
