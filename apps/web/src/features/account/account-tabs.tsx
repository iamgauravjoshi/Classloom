import { cn } from '@classloom/ui/lib/utils';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

const TABS = [
  { id: 'profile', href: '/account' },
  { id: 'security', href: '/account/security' },
] as const;

export type AccountTab = (typeof TABS)[number]['id'];

/** "Profile" and "Security": links between the account pages, the open one marked current. */
export function AccountTabs({ current }: { current: AccountTab }) {
  const t = useTranslations('account.tabs');
  return (
    <nav aria-label={t('label')} className="border-border border-b">
      <ul className="-mb-px flex gap-1">
        {TABS.map((tab) => {
          const active = tab.id === current;
          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'focus-visible:ring-ring/50 inline-flex min-h-11 items-center border-b-2 px-4 text-sm font-medium outline-none focus-visible:ring-3',
                  active
                    ? 'border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground border-transparent',
                )}
              >
                {t(tab.id)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
