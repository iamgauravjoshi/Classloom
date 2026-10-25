'use client';

import { Button } from '@classloom/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@classloom/ui/components/ui/dropdown-menu';
import { IconCalendar } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/** `2026-27` → `2025-26`. */
function previousYear(year: string): string {
  const start = Number(year.slice(0, 4)) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Academic-year picker in the top bar. Switching is local until academic years exist (Phase 1). */
export function AcademicYearSwitcher({ year }: { year: string }) {
  const t = useTranslations('shell');
  const [selected, setSelected] = useState(year);
  const years = [year, previousYear(year)];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="h-11 min-w-11 md:h-7" />}
      >
        <IconCalendar data-icon="inline-start" />
        <span className="sr-only sm:not-sr-only">{t('academicYearValue', { year: selected })}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('academicYear')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={selected}
            onValueChange={(value: string) => setSelected(value)}
          >
            {years.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
                {option}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
