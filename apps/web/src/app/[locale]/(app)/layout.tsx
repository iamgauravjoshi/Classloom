import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { routing } from '@/i18n/routing';
import { PATHNAME_HEADER } from '@/lib/auth-redirect';
import { requireServerSession } from '@/lib/server-session';
import { toShellSession } from '@/lib/session';
import { twoFactorSetupRedirect } from '@/lib/setup-redirect';

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Validated by the API on every request; signed out or expired goes to sign-in and back.
  const session = await requireServerSession();

  // A role that requires two-step, and no two-step yet: only the setup page may open, and it is
  // drawn without the shell (whose links would all lead back here).
  const location = (await headers()).get(PATHNAME_HEADER) ?? `/${routing.defaultLocale}/dashboard`;
  const setup = twoFactorSetupRedirect(session.twoFactorSetupRequired, location);
  if (setup) redirect(setup);
  if (session.twoFactorSetupRequired) return <main>{children}</main>;

  // shadcn's sidebar persists its expanded/collapsed state in this cookie.
  const jar = await cookies();
  const defaultOpen = jar.get('sidebar_state')?.value !== 'false';
  // The year and campus being looked at; the shell checks them against the school's own lists.
  const selection = { year: jar.get('cl_year')?.value, campus: jar.get('cl_campus')?.value };

  return (
    <AppShell session={toShellSession(session)} defaultOpen={defaultOpen} selection={selection}>
      {children}
    </AppShell>
  );
}
