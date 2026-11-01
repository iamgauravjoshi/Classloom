import { safeNextPath } from '@classloom/utils';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SignInFlow } from '@/features/auth/sign-in-flow';
import { routing } from '@/i18n/routing';
import { getServerSession } from '@/lib/server-session';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/sign-in'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.signIn' });
  return { title: t('metaTitle') };
}

const single = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value : undefined;

export default async function SignInPage({ params, searchParams }: PageProps<'/[locale]/sign-in'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  // Anything but a same-site path in a supported locale (open redirects, loops) goes to the dashboard.
  const nextPath = safeNextPath(single(query.next), routing.locales, `/${locale}/dashboard`);

  // `?reauth=1` is honoured only for a signed-in visitor, whose own school and email it uses;
  // for anyone else it is ignored and the normal flow runs.
  let reauth: { schoolCode: string; email: string; remember: boolean } | null = null;
  if (single(query.reauth) === '1') {
    try {
      const session = await getServerSession();
      if (session) {
        reauth = {
          schoolCode: session.school.code,
          email: session.user.email,
          remember: session.remember,
        };
      }
    } catch {
      // The API is unreachable: the normal flow will report the problem.
    }
  }

  return (
    <SignInFlow
      initialSchool={single(query.school)?.trim() || null}
      nextPath={nextPath}
      reauth={reauth}
    />
  );
}
