import { cn } from '@classloom/ui/lib/utils';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

const TABS = [
  { id: 'members', href: '/users-roles' },
  { id: 'roles', href: '/users-roles?tab=roles' },
] as const;

export type UsersRolesTab = (typeof TABS)[number]['id'];

/** "Members" and "Roles": links between the two views, the open one marked current. */
export function UsersRolesTabs({ current }: { current: UsersRolesTab }) {
  const t = useTranslations('iam.tabs');
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
