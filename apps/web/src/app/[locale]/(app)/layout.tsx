import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { AppShell, type ShellSession } from '@/components/shell/app-shell';
import { getMockSession } from '@/lib/mock-session';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = getMockSession();
  // shadcn's sidebar persists its expanded/collapsed state in this cookie.
  const defaultOpen = (await cookies()).get('sidebar_state')?.value !== 'false';
  const shellSession: ShellSession = { ...session, permissions: [...session.permissions] };

  return (
    <AppShell session={shellSession} defaultOpen={defaultOpen}>
      {children}
    </AppShell>
  );
}
