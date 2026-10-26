'use client';

import { PageHeader, type PageHeaderProps } from '@classloom/ui/components/page-header';

import { Link } from '@/i18n/navigation';

/**
 * PageHeader with locale-aware client-side breadcrumb links. Lives in a client component because
 * Base UI's `render` composition cannot pass merged props into a client `Link` from the server.
 */
export function AppPageHeader(props: Omit<PageHeaderProps, 'renderLink'>) {
  return <PageHeader {...props} renderLink={(href) => <Link href={href} />} />;
}
