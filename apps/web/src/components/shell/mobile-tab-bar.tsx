'use client';

import { useSidebar } from '@classloom/ui/components/ui/sidebar';
import { cn } from '@classloom/ui/lib/utils';
import { IconCalendarTime, IconCash, IconDots, IconLayoutDashboard } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';

const TABS = [
  { key: 'dashboard', href: '/dashboard', icon: IconLayoutDashboard },
  { key: 'timetable', href: '/timetable', icon: IconCalendarTime },
  { key: 'fees', href: '/fees', icon: IconCash },
] as const;

const tabClass = 'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs';

/** Bottom tab bar for teacher, parent and student portals on phones (below md). */
export function MobileTabBar() {
  const t = useTranslations();
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <nav
      aria-label={t('shell.mobileNavigation')}
      className="border-border bg-card fixed inset-x-0 bottom-0 flex border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {TABS.map(({ key, href, icon: TabIcon }) => {
        const active = pathname === href;
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(tabClass, active ? 'text-primary-text' : 'text-muted-foreground')}
          >
            <TabIcon size={22} aria-hidden="true" />
            {t(`nav.${key}`)}
          </Link>
        );
      })}
      <button
        type="button"
        className={cn(tabClass, 'text-muted-foreground')}
        onClick={() => setOpenMobile(true)}
      >
        <IconDots size={22} aria-hidden="true" />
        {t('shell.more')}
      </button>
    </nav>
  );
}
