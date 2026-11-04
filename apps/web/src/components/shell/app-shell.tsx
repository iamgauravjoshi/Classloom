'use client';

import { useGetAuthSession } from '@classloom/api-client';
import { SidebarInset, SidebarProvider } from '@classloom/ui/components/ui/sidebar';
import type { ReactNode } from 'react';

import type { Portal, ShellSession } from '@/lib/session';

import { AppSidebar } from './app-sidebar';
import { MobileTabBar } from './mobile-tab-bar';
import { SelectionProvider } from './selection-provider';
import { Topbar } from './topbar';

/** The phone tab bar is for the parent and student portals; staff use the sidebar. */
const TAB_BAR_PORTALS: ReadonlySet<Portal> = new Set(['parent', 'student']);

/** The API slides a session at most every 5 minutes, so re-checking sooner is wasted. */
const SESSION_SLIDE_STALE_MS = 5 * 60_000;

export function AppShell({
  session,
  defaultOpen,
  selection,
  children,
}: {
  session: ShellSession;
  defaultOpen: boolean;
  /** The `cl_year` and `cl_campus` cookies, read by the server layout. */
  selection: { year: string | undefined; campus: string | undefined };
  children: ReactNode;
}) {
  // The browser's own session check slides a remembered cookie: the server layout's check sends
  // `X-Session-Touch: skip`, because a Set-Cookie on that call could never reach the browser.
  // A 401 here also sends the person to sign-in (see `onQueryError`).
  useGetAuthSession({ query: { staleTime: SESSION_SLIDE_STALE_MS } });
  const showTabBar = TAB_BAR_PORTALS.has(session.portal);
  return (
    <SelectionProvider yearCookie={selection.year} campusCookie={selection.campus}>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar permissions={session.permissions} />
        <SidebarInset className="min-w-0">
          <Topbar session={session} />
          <div id="main" className={showTabBar ? 'flex-1 p-4 pb-24 md:p-6' : 'flex-1 p-4 md:p-6'}>
            {children}
          </div>
        </SidebarInset>
        {showTabBar && <MobileTabBar />}
      </SidebarProvider>
    </SelectionProvider>
  );
}
