import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AccessDenied } from '@/components/access-denied';
import { AppPageHeader } from '@/components/app-page-header';
import { RoleEditor } from '@/features/iam/role-editor';
import { canOpenSection } from '@/lib/page-access';
import { requireServerSession } from '@/lib/server-session';
import { toShellSession } from '@/lib/session';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/users-roles/roles/new'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'iam.roleEditor' });
  return { title: t('createTitle') };
}

export default async function NewRolePage({
  params,
  searchParams,
}: PageProps<'/[locale]/users-roles/roles/new'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('iam');
  const session = await requireServerSession();
  // Creating a role needs `iam.manage`; the page itself needs `iam.view`.
  if (
    !canOpenSection('users-roles', session.permissions) ||
    !session.permissions.includes('iam.manage')
  ) {
    return (
      <AccessDenied
        title={t('title')}
        canOpenDashboard={canOpenSection('dashboard', session.permissions)}
      />
    );
  }
  const { clone } = await searchParams;
  const { isOwner, permissions } = toShellSession(session);
  const title = t('roleEditor.createTitle');
  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader
        title={title}
        breadcrumbs={[{ label: t('title'), href: '/users-roles?tab=roles' }, { label: title }]}
      />
      <RoleEditor
        roleId={null}
        cloneId={typeof clone === 'string' ? clone : undefined}
        viewer={{ userId: session.user.id, permissions, isOwner, schoolCode: session.school.code }}
      />
    </div>
  );
}
