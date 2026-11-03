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
}: PageProps<'/[locale]/users-roles/roles/[id]'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'iam.roleEditor' });
  return { title: t('editTitle') };
}

export default async function EditRolePage({
  params,
}: PageProps<'/[locale]/users-roles/roles/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('iam');
  const session = await requireServerSession();
  if (!canOpenSection('users-roles', session.permissions)) {
    return (
      <AccessDenied
        title={t('title')}
        canOpenDashboard={canOpenSection('dashboard', session.permissions)}
      />
    );
  }
  const { isOwner, permissions } = toShellSession(session);
  const title = permissions.includes('iam.manage')
    ? t('roleEditor.editTitle')
    : t('roleEditor.viewTitle');
  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader
        title={title}
        breadcrumbs={[{ label: t('title'), href: '/users-roles?tab=roles' }, { label: title }]}
      />
      <RoleEditor
        roleId={id}
        viewer={{ userId: session.user.id, permissions, isOwner, schoolCode: session.school.code }}
      />
    </div>
  );
}
