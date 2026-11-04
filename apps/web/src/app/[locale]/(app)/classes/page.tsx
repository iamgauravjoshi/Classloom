import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AccessDenied } from '@/components/access-denied';
import { AppPageHeader } from '@/components/app-page-header';
import { classesTabOf, ClassesTabs } from '@/features/academics/classes-tabs';
import { HousesTab } from '@/features/academics/houses-tab';
import { RoomsTab } from '@/features/academics/rooms-tab';
import { SectionsTab } from '@/features/academics/sections-tab';
import { StreamsTab } from '@/features/academics/streams-tab';
import { canOpenSection } from '@/lib/page-access';
import { requireServerSession } from '@/lib/server-session';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/classes'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'academics' });
  return { title: t('metaTitle') };
}

/**
 * Classes & sections (academics spec section 8), with `classes.view`: the Sections, Streams,
 * Houses and Rooms tabs, chosen by `?tab=`. `classes.manage` holders get the edit controls.
 */
export default async function ClassesPage({
  params,
  searchParams,
}: PageProps<'/[locale]/classes'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('academics');
  const session = await requireServerSession();
  // `classes.view` comes from the navigation config, like every other page's permission.
  if (!canOpenSection('classes', session.permissions)) {
    return (
      <AccessDenied
        title={t('title')}
        canOpenDashboard={canOpenSection('dashboard', session.permissions)}
      />
    );
  }
  const canEdit = session.permissions.includes('classes.manage');
  const current = classesTabOf((await searchParams).tab);

  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader title={t('title')} breadcrumbs={[{ label: t('title') }]} />
      <p className="text-muted-foreground -mt-3">{t('description')}</p>
      <ClassesTabs current={current} />
      {current === 'streams' ? <StreamsTab canEdit={canEdit} /> : null}
      {current === 'houses' ? <HousesTab canEdit={canEdit} /> : null}
      {current === 'rooms' ? <RoomsTab canEdit={canEdit} /> : null}
      {current === 'sections' ? (
        <SectionsTab
          canEdit={canEdit}
          canManageSettings={session.permissions.includes('settings.manage')}
        />
      ) : null}
    </div>
  );
}
