import { cn } from '@classloom/ui/lib/utils';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

export const CLASSES_TABS = ['sections', 'streams', 'houses', 'rooms'] as const;
export type ClassesTab = (typeof CLASSES_TABS)[number];

/** The tab a `?tab=` value names; Sections when it names none. */
export function classesTabOf(value: string | string[] | undefined): ClassesTab {
  return (CLASSES_TABS as readonly string[]).includes(value as string)
    ? (value as ClassesTab)
    : 'sections';
}

const hrefOf = (tab: ClassesTab) => (tab === 'sections' ? '/classes' : `/classes?tab=${tab}`);

/** Sections, Streams, Houses and Rooms: links between the views, the open one marked current. */
export function ClassesTabs({ current }: { current: ClassesTab }) {
  const t = useTranslations('academics.tabs');
  return (
    <nav aria-label={t('label')} className="border-border border-b">
      <ul className="-mb-px flex flex-wrap gap-x-1">
        {CLASSES_TABS.map((tab) => {
          const active = tab === current;
          return (
            <li key={tab}>
              <Link
                href={hrefOf(tab)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'focus-visible:ring-ring/50 inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium outline-none focus-visible:ring-3 sm:px-4',
                  active
                    ? 'border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground border-transparent',
                )}
              >
                {t(tab)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
