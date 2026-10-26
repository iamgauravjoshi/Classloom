import { buttonVariants } from '@classloom/ui/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@classloom/ui/components/ui/card';
import { IconHourglass } from '@tabler/icons-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AppPageHeader } from '@/components/app-page-header';
import { comingSoonSections, navConfig } from '@/config/nav';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

// Only the placeholder sections in the nav exist; any other single-segment path is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    comingSoonSections.map((section) => ({ locale, section })),
  );
}

function navKeyFor(section: string): string | undefined {
  return navConfig.flatMap((group) => group.items).find((item) => item.href === `/${section}`)?.key;
}

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/[section]'>): Promise<Metadata> {
  const { locale, section } = await params;
  const key = navKeyFor(section);
  if (!key) return {};
  const t = await getTranslations({ locale, namespace: 'nav' });
  return { title: t(key) };
}

export default async function ComingSoonPage({ params }: PageProps<'/[locale]/[section]'>) {
  const { locale, section } = await params;
  const key = navKeyFor(section);
  if (!key) notFound();
  setRequestLocale(locale);
  const t = await getTranslations();
  const title = t(`nav.${key}`);

  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader
        title={title}
        breadcrumbs={[{ label: t('nav.dashboard'), href: '/dashboard' }, { label: title }]}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-h4 flex items-center gap-2">
            <IconHourglass aria-hidden="true" />
            {t('comingSoon.title', { section: title })}
          </CardTitle>
          <CardDescription>{t('comingSoon.body')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/dashboard" className={buttonVariants({ variant: 'outline' })}>
            {t('comingSoon.back')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
