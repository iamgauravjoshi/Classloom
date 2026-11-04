import { cn } from '@classloom/ui/lib/utils';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AccessDenied } from '@/components/access-denied';
import { AppPageHeader } from '@/components/app-page-header';
import { ClassSubjectsGrid } from '@/features/academics/class-subjects-grid';
import { SubjectsTab } from '@/features/academics/subjects-tab';
import { Link } from '@/i18n/navigation';
import { canOpenSection } from '@/lib/page-access';
import { requireServerSession } from '@/lib/server-session';

const SUBJECTS_TABS = ['subjects', 'classSubjects'] as const;
type SubjectsTabKey = (typeof SUBJECTS_TABS)[number];

/** The tab a `?tab=` value names (`class-subjects`); Subjects when it names none. */
const tabOf = (value: string | string[] | undefined): SubjectsTabKey =>
  value === 'class-subjects' ? 'classSubjects' : 'subjects';
const hrefOf = (tab: SubjectsTabKey) =>
  tab === 'subjects' ? '/subjects' : '/subjects?tab=class-subjects';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/subjects'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'academics.subjectsPage' });
  return { title: t('metaTitle') };
}

/**
 * Subjects (academics spec section 8), with `subjects.view`: the Subjects and Class subjects tabs,
 * chosen by `?tab=`. `subjects.manage` holders get the edit controls.
 */
export default async function SubjectsPage({
  params,
  searchParams,
}: PageProps<'/[locale]/subjects'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('academics.subjectsPage');
  const session = await requireServerSession();
  if (!canOpenSection('subjects', session.permissions)) {
    return (
      <AccessDenied
        title={t('title')}
        canOpenDashboard={canOpenSection('dashboard', session.permissions)}
      />
    );
  }
  const canEdit = session.permissions.includes('subjects.manage');
  const current = tabOf((await searchParams).tab);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <AppPageHeader title={t('title')} breadcrumbs={[{ label: t('title') }]} />
      <p className="text-muted-foreground -mt-3">{t('description')}</p>
      <nav aria-label={t('tabs.label')} className="border-border border-b">
        <ul className="-mb-px flex flex-wrap gap-x-1">
          {SUBJECTS_TABS.map((tab) => {
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
                  {t(`tabs.${tab}`)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {current === 'subjects' ? <SubjectsTab canEdit={canEdit} /> : null}
      {current === 'classSubjects' ? (
        <ClassSubjectsGrid
          canEdit={canEdit}
          canManageSettings={session.permissions.includes('settings.manage')}
        />
      ) : null}
    </div>
  );
}
