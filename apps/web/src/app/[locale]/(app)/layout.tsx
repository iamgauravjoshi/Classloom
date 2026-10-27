import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { allNavPermissions } from '@/config/nav';
import { requireServerSession } from '@/lib/server-session';
import { toShellSession } from '@/lib/session';

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Validated by the API on every request; signed out or expired goes to sign-in and back.
  const session = await requireServerSession();
  // shadcn's sidebar persists its expanded/collapsed state in this cookie.
  const defaultOpen = (await cookies()).get('sidebar_state')?.value !== 'false';

  return (
    <AppShell session={toShellSession(session, allNavPermissions)} defaultOpen={defaultOpen}>
      {children}
    </AppShell>
  );
}
