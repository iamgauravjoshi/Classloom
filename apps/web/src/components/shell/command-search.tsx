'use client';

import { Button } from '@classloom/ui/components/ui/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@classloom/ui/components/ui/command';
import { Command } from '@classloom/ui/components/ui/command';
import { IconSearch } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { navConfig } from '@/config/nav';
import { useRouter } from '@/i18n/navigation';
import { filterNav } from '@/lib/nav-filter';

/** ⌘K / Ctrl+K page search over the navigation the user can access. */
export function CommandSearch({ permissions }: { permissions: string[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const items = useMemo(
    () => filterNav(navConfig, new Set(permissions)).flatMap((group) => group.items),
    [permissions],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-muted-foreground h-11 min-w-11 justify-start md:h-7 md:w-64"
        onClick={() => setOpen(true)}
      >
        <IconSearch data-icon="inline-start" />
        <span className="sr-only md:not-sr-only md:truncate">{t('shell.searchPlaceholder')}</span>
        <kbd
          aria-hidden="true"
          className="border-border ml-auto hidden rounded-sm border px-1.5 text-xs md:inline"
        >
          {t('shell.searchShortcut')}
        </kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t('shell.searchTitle')}
        description={t('shell.searchDescription')}
      >
        <Command>
          <CommandInput placeholder={t('shell.searchPlaceholder')} />
          <CommandList>
            <CommandEmpty>{t('shell.noResults')}</CommandEmpty>
            <CommandGroup heading={t('shell.pages')}>
              {items.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <CommandItem
                    key={item.key}
                    value={t(`nav.${item.key}`)}
                    onSelect={() => {
                      setOpen(false);
                      router.push(item.href);
                    }}
                  >
                    <ItemIcon />
                    {t(`nav.${item.key}`)}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
