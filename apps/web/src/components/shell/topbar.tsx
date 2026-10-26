'use client';

import { Button } from '@classloom/ui/components/ui/button';
import { SidebarTrigger } from '@classloom/ui/components/ui/sidebar';
import { IconBell } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';

import { AcademicYearSwitcher } from './academic-year-switcher';
import type { ShellSession } from './app-shell';
import { CommandSearch } from './command-search';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

export function Topbar({ session }: { session: ShellSession }) {
  const t = useTranslations('shell');
  return (
    <header className="border-border bg-card sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-4">
      <SidebarTrigger aria-label={t('toggleSidebar')} className="size-7 pointer-coarse:size-11" />
      <CommandSearch permissions={session.permissions} />
      <div className="ml-auto flex min-w-0 items-center gap-1">
        <AcademicYearSwitcher year={session.academicYear} />
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('notifications')}
          className="size-7 pointer-coarse:size-11"
        >
          <IconBell />
        </Button>
        <UserMenu user={session.user} role={session.role} />
      </div>
    </header>
  );
}
