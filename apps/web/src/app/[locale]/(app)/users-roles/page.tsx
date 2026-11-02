import { Card, CardDescription, CardHeader, CardTitle } from '@classloom/ui/components/ui/card';
import { IconHourglass } from '@tabler/icons-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AccessDenied } from '@/components/access-denied';
import { AppPageHeader } from '@/components/app-page-header';
import { MembersSection } from '@/features/iam/members-section';
import { UsersRolesTabs } from '@/features/iam/users-roles-tabs';
import { canOpenSection } from '@/lib/page-access';
import { requireServerSession } from '@/lib/server-session';
import { toShellSession } from '@/lib/session';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/users-roles'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'iam' });
  return { title: t('metaTitle') };
}

export default async function UsersRolesPage({
  params,
  searchParams,
}: PageProps<'/[locale]/users-roles'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('iam');
  const session = await requireServerSession();
  // `iam.view` comes from the navigation config, like every other page's permission.
  if (!canOpenSection('users-roles', session.permissions)) {
    return (
      <AccessDenied
        title={t('title')}
        canOpenDashboard={canOpenSection('dashboard', session.permissions)}
      />
    );
  }
  const { tab } = await searchParams;
  const current = tab === 'roles' ? 'roles' : 'members';
  const { isOwner, permissions } = toShellSession(session);

  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader title={t('title')} breadcrumbs={[{ label: t('title') }]} />
      <UsersRolesTabs current={current} />
      {current === 'members' ? (
        <MembersSection
          viewer={{
            userId: session.user.id,
            permissions,
            isOwner,
            schoolCode: session.school.code,
          }}
        />
      ) : (
        // The Roles tab's content comes with the role editor.
        <Card>
          <CardHeader>
            <CardTitle className="text-h5">
              <h2 className="flex items-center gap-2">
                <IconHourglass aria-hidden="true" />
                {t('rolesTab.title')}
              </h2>
            </CardTitle>
            <CardDescription>{t('rolesTab.body')}</CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
