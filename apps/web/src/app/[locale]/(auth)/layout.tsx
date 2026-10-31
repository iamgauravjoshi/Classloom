import { setRequestLocale } from 'next-intl/server';

import { redirect } from '@/i18n/navigation';
import { getServerSession } from '@/lib/server-session';

/**
 * Sign-in, forgot and reset: no app shell. Each page draws its own `AuthCard` (already full height
 * and centred), so this adds only the landmark. Someone already signed in goes to the dashboard.
 */
export default async function AuthLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  let signedIn = false;
  try {
    signedIn = (await getServerSession()) !== null;
  } catch {
    // The API is unreachable: show the page; signing in will report the problem.
  }
  if (signedIn) redirect({ href: '/dashboard', locale });

  return <main>{children}</main>;
}
