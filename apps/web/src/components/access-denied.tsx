import { buttonVariants } from '@classloom/ui/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@classloom/ui/components/ui/card';
import { IconLock } from '@tabler/icons-react';
import { getTranslations } from 'next-intl/server';

import { AppPageHeader } from '@/components/app-page-header';
import { Link } from '@/i18n/navigation';

interface AccessDeniedProps {
  /** The page's own title (it keeps the h1, so the page is still named). */
  title: string;
  /** The dashboard is the way back only for a member who may open it; else their account. */
  canOpenDashboard: boolean;
}

/** What a module page shows to a member whose role lacks the page's permission. */
export async function AccessDenied({ title, canOpenDashboard }: AccessDeniedProps) {
  const t = await getTranslations('accessDenied');
  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader title={title} breadcrumbs={[{ label: title }]} />
      <Card>
        <CardHeader>
          <CardTitle className="text-h4">
            <h2 className="flex items-center gap-2">
              <IconLock aria-hidden="true" />
              {t('title')}
            </h2>
          </CardTitle>
          <CardDescription>{t('body')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href={canOpenDashboard ? '/dashboard' : '/account'}
            className={buttonVariants({ variant: 'outline' })}
          >
            {canOpenDashboard ? t('backToDashboard') : t('toAccount')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
