import { StatusPill } from '@classloom/ui/components/status-pill';
import { buttonVariants } from '@classloom/ui/components/ui/button';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/privacy'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'registration.legal' });
  return { title: t('privacyTitle') };
}

export default async function PrivacyPage({ params }: PageProps<'/[locale]/privacy'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('registration.legal');
  return (
    <article className="flex flex-col items-start gap-4">
      <StatusPill tone="warning">{t('draftBadge')}</StatusPill>
      <h1 className="text-h3">{t('privacyTitle')}</h1>
      <p className="text-muted-foreground">{t('privacyBody')}</p>
      <Link href="/register-school" className={buttonVariants({ variant: 'outline' })}>
        {t('back')}
      </Link>
    </article>
  );
}
