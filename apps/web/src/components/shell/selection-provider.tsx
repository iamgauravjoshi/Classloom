'use client';

import {
  type AcademicYearsResponseDtoYearsItem,
  type CampusDto,
  useListAcademicYears,
  useListCampuses,
} from '@classloom/api-client';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

import { pickCampus, pickYear, writeSelection } from '@/lib/selection-cookies';

/** Years and campuses change rarely, and the Settings forms refresh these lists themselves. */
const LIST_STALE_MS = 5 * 60_000;

export type SelectableYear = AcademicYearsResponseDtoYearsItem;

export interface SelectedYear {
  /** The year being looked at: the remembered one, else the current one, else null. */
  year: SelectableYear | null;
  /** The school's years, newest first. */
  years: SelectableYear[];
  isPending: boolean;
  select: (id: string) => void;
}

export interface SelectedCampus {
  /** The campus being looked at: the remembered active one, else the primary one. */
  campus: CampusDto | null;
  /** The active campuses, primary first. */
  campuses: CampusDto[];
  isPending: boolean;
  select: (id: string) => void;
}

const YearContext = createContext<SelectedYear | null>(null);
const CampusContext = createContext<SelectedCampus | null>(null);

/**
 * Holds the year and campus chosen in the shell's switchers (spec §6, §7). Both lists are fetched
 * here, once, for the switchers and for later modules (`useSelectedYear`, `useSelectedCampus`).
 * The cookies are read by the server layout and passed in, so the first render agrees with it.
 * Nothing is filtered by them yet.
 */
export function SelectionProvider({
  yearCookie,
  campusCookie,
  children,
}: {
  yearCookie: string | undefined;
  campusCookie: string | undefined;
  children: ReactNode;
}) {
  const yearsQuery = useListAcademicYears({ query: { staleTime: LIST_STALE_MS, retry: 1 } });
  const campusesQuery = useListCampuses(undefined, {
    query: { staleTime: LIST_STALE_MS, retry: 1 },
  });
  const [yearId, setYearId] = useState(yearCookie);
  const [campusId, setCampusId] = useState(campusCookie);

  const yearValue = useMemo<SelectedYear>(() => {
    const years = yearsQuery.data?.years ?? [];
    return {
      year: pickYear(years, yearId),
      years,
      isPending: yearsQuery.isPending,
      select: (id) => {
        writeSelection('cl_year', id);
        setYearId(id);
      },
    };
  }, [yearsQuery.data, yearsQuery.isPending, yearId]);

  const campusValue = useMemo<SelectedCampus>(() => {
    const campuses = campusesQuery.data?.campuses ?? [];
    return {
      campus: pickCampus(campuses, campusId),
      campuses,
      isPending: campusesQuery.isPending,
      select: (id) => {
        writeSelection('cl_campus', id);
        setCampusId(id);
      },
    };
  }, [campusesQuery.data, campusesQuery.isPending, campusId]);

  return (
    <YearContext.Provider value={yearValue}>
      <CampusContext.Provider value={campusValue}>{children}</CampusContext.Provider>
    </YearContext.Provider>
  );
}

/** The academic year chosen in the top bar. Use inside the app shell. */
export function useSelectedYear(): SelectedYear {
  const value = useContext(YearContext);
  if (!value) throw new Error('useSelectedYear must be used inside the app shell');
  return value;
}

/** The campus chosen in the sidebar. Use inside the app shell. */
export function useSelectedCampus(): SelectedCampus {
  const value = useContext(CampusContext);
  if (!value) throw new Error('useSelectedCampus must be used inside the app shell');
  return value;
}
