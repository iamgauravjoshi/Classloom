import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { PATHNAME_HEADER, signedInAuthRedirect } from '@/lib/auth-redirect';
import { getServerSession } from '@/lib/server-session';

/**
 * Sign-in, forgot and reset: no app shell. Each page draws its own `AuthCard` (already full height
 * and centred), so this adds only the landmark. A signed-in visitor leaves sign-in (for a safe
 * `?next=`, else the dashboard) and forgot-password; the reset page stays (see
 * `signedInAuthRedirect`).
 */
export default async function AuthLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Set by `proxy.ts`: the page and query that was asked for.
  const target = signedInAuthRedirect((await headers()).get(PATHNAME_HEADER) ?? `/${locale}`);
  if (target) {
    let signedIn = false;
    try {
      signedIn = (await getServerSession()) !== null;
    } catch {
      // The API is unreachable: show the page; signing in will report the problem.
    }
    if (signedIn) redirect(target);
  }

  return <main>{children}</main>;
}
