'use client';

import { Button } from '@classloom/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@classloom/ui/components/ui/dropdown-menu';
import { IconCalendar, IconCalendarPlus } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

import { useSelectedYear } from './selection-provider';

/**
 * Academic-year picker in the top bar (spec §6). The choice is remembered in `cl_year`; a stale
 * one falls back to the current year. With no years it offers "Set up academic year": the wizard
 * for people who manage settings, the Settings page for those who can view it, plain text otherwise.
 */
export function AcademicYearSwitcher({ permissions }: { permissions: string[] }) {
  const t = useTranslations('shell');
  const { year, years, isPending, select } = useSelectedYear();
  const setupHref = permissions.includes('settings.manage')
    ? '/onboarding?step=academicYear'
    : permissions.includes('settings.view')
      ? '/settings/academic-years'
      : null;

  const value = year ? year.label : isPending ? t('academicYearLoading') : t('academicYearNone');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 pointer-coarse:h-11 pointer-coarse:min-w-11"
          />
        }
      >
        <IconCalendar data-icon="inline-start" />
        <span className="sr-only sm:not-sr-only">{t('academicYearValue', { year: value })}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('academicYear')}</DropdownMenuLabel>
          {years.length > 0 ? (
            <DropdownMenuRadioGroup
              value={year?.id ?? ''}
              onValueChange={(id: string) => select(id)}
            >
              {years.map((option) => (
                <DropdownMenuRadioItem
                  key={option.id}
                  value={option.id}
                  className="pointer-coarse:min-h-11"
                >
                  {option.status === 'CURRENT'
                    ? t('academicYearCurrent', { year: option.label })
                    : option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          ) : isPending ? (
            <p className="text-muted-foreground px-2 py-1.5 text-sm" role="status">
              {t('academicYearLoading')}
            </p>
          ) : setupHref ? (
            <DropdownMenuItem
              className="pointer-coarse:min-h-11"
              render={<Link href={setupHref} />}
            >
              <IconCalendarPlus />
              {t('setUpAcademicYear')}
            </DropdownMenuItem>
          ) : (
            <p className="text-muted-foreground max-w-64 px-2 py-1.5 text-sm">
              {t('noAcademicYear')}
            </p>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
