import { buttonVariants } from '@classloom/ui/components/ui/button';
import { IconMapOff } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

export default function NotFound() {
  const t = useTranslations('notFound');
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <IconMapOff size={40} stroke={1.5} className="text-muted-foreground" aria-hidden="true" />
        <h1 className="text-h3">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('body')}</p>
        <Link href="/dashboard" className={buttonVariants()}>
          {t('back')}
        </Link>
      </div>
    </main>
  );
}
