'use client';

import { Button } from '@classloom/ui/components/ui/button';
import { IconMoon, IconSun } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';

export function ThemeToggle() {
  const t = useTranslations('shell');
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t('toggleTheme')}
      className="size-11 md:size-7"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      {/* Both icons render so server and client markup match; CSS shows the right one. */}
      <IconSun className="dark:hidden" />
      <IconMoon className="hidden dark:block" />
    </Button>
  );
}
