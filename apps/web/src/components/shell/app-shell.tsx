'use client';

import { SidebarInset, SidebarProvider } from '@classloom/ui/components/ui/sidebar';
import type { ReactNode } from 'react';

import type { Role } from '@/lib/mock-session';

import { AppSidebar } from './app-sidebar';
import { MobileTabBar } from './mobile-tab-bar';
import { Topbar } from './topbar';

/** Serializable slice of the session passed from the server layout. */
export interface ShellSession {
  user: { name: string; avatarUrl?: string };
  role: Role;
  permissions: string[];
  campus: { id: string; name: string };
  academicYear: string;
}

const TAB_BAR_ROLES: ReadonlySet<Role> = new Set(['teacher', 'parent', 'student']);

export function AppShell({
  session,
  defaultOpen,
  children,
}: {
  session: ShellSession;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const showTabBar = TAB_BAR_ROLES.has(session.role);
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar permissions={session.permissions} campus={session.campus} />
      <SidebarInset className="min-w-0">
        <Topbar session={session} />
        <main id="main" className={showTabBar ? 'flex-1 p-4 pb-24 md:p-6' : 'flex-1 p-4 md:p-6'}>
          {children}
        </main>
      </SidebarInset>
      {showTabBar && <MobileTabBar />}
    </SidebarProvider>
  );
}
