import { IconCheck, IconSchool } from '@tabler/icons-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';

/** Public pages (registration, legal): no app shell. Brand panel from `lg`, single column below. */
export default async function PublicLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('registration.brand');
  const tApp = await getTranslations('app');
  const points = [t('points.one'), t('points.two'), t('points.three')];

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="bg-primary text-primary-foreground hidden flex-col justify-between p-10 lg:flex">
        <Link href="/" className="flex items-center gap-2 text-xl font-semibold">
          <IconSchool size={28} aria-hidden="true" />
          {tApp('name')}
        </Link>
        <div className="flex flex-col gap-6">
          <h2 className="text-h2">{t('tagline')}</h2>
          <ul className="flex flex-col gap-3">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-2">
                <IconCheck size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm opacity-80">© Classloom</p>
      </aside>
      <main className="flex flex-col items-center px-4 py-6 sm:px-8 lg:justify-center lg:py-10">
        <div className="mb-6 flex items-center gap-2 self-start text-lg font-semibold lg:hidden">
          <IconSchool size={24} className="text-primary-text" aria-hidden="true" />
          {tApp('name')}
        </div>
        <div className="w-full max-w-lg">{children}</div>
      </main>
    </div>
  );
}
