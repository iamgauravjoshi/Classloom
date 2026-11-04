'use client';

import { useCopySectionsFromPrevious, useListSections } from '@classloom/api-client';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button } from '@classloom/ui/components/ui/button';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { IconCopy, IconPlus } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import type { SelectableYear } from '@/components/shell/selection-provider';

import { BUTTON_CLASS } from '../auth/auth-ui';
import { formatList, useAcademicsErrorText } from './academics-errors';
import { type DroppedField, groupDropped, previousYearOf } from './section-helpers';

/** What a copy did: how many sections it made, from which year, and what it left out. */
export interface CopyOutcome {
  created: number;
  fromYear: string;
  dropped: { section: string; field: DroppedField }[];
}

/**
 * The empty year's actions: "Copy N sections from 2025–26" when the year before (the latest one
 * that ends before this one starts) has sections on this campus, and "Add your first section".
 */
export function CopyOffer({
  year,
  years,
  campusId,
  onCopied,
  onAddFirst,
}: {
  year: SelectableYear;
  years: SelectableYear[];
  campusId: string;
  onCopied: (outcome: CopyOutcome) => void;
  onAddFirst: () => void;
}) {
  const t = useTranslations('academics.sections');
  const errorText = useAcademicsErrorText();
  const previous = previousYearOf(years, year);
  const source = useListSections(
    { yearId: previous?.id ?? '', campusId },
    { query: { enabled: previous !== null } },
  );
  const copy = useCopySectionsFromPrevious();
  const [error, setError] = useState<string | null>(null);
  const count = source.data?.sections.length ?? 0;

  async function run() {
    if (!previous) return;
    setError(null);
    try {
      const result = await copy.mutateAsync({ data: { yearId: year.id, campusId } });
      onCopied({ created: result.created, dropped: result.dropped, fromYear: previous.label });
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  // Until the earlier year's sections are known, only the plain way in is offered.
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {count > 0 && previous ? (
          <Button className={BUTTON_CLASS} disabled={copy.isPending} onClick={() => void run()}>
            {copy.isPending ? <Spinner aria-hidden="true" /> : <IconCopy aria-hidden="true" />}
            {copy.isPending ? t('copying') : t('copy', { count, year: previous.label })}
          </Button>
        ) : null}
        <Button
          variant={count > 0 ? 'outline' : 'default'}
          className={BUTTON_CLASS}
          disabled={copy.isPending}
          onClick={onAddFirst}
        >
          <IconPlus aria-hidden="true" />
          {t('addFirst')}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription role="alert">{error}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

/**
 * The copy's summary: how many sections came across and, by kind, the sections that lost their
 * room, class teacher or stream, or weren't copied as their class is outside the range. It takes
 * focus when it appears, as the button that made it is gone.
 */
export function CopyResult({
  outcome,
  onDismiss,
}: {
  outcome: CopyOutcome;
  onDismiss: () => void;
}) {
  const t = useTranslations('academics.sections.copyResult');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const groups = groupDropped(outcome.dropped);
  useEffect(() => titleRef.current?.focus(), []);

  return (
    <div className="bg-card flex flex-col items-start gap-3 rounded-xl border p-5">
      <h3 ref={titleRef} tabIndex={-1} className="text-h6 break-words outline-none">
        {t('title', { count: outcome.created, year: outcome.fromYear })}
      </h3>
      {groups.length === 0 ? (
        <p className="text-muted-foreground">{t('allCopied')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p>{t('someDropped')}</p>
          <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5">
            {groups.map(({ field, sections }) => (
              <li key={field} className="break-words">
                {t(field, { sections: formatList(sections) })}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button variant="outline" className={BUTTON_CLASS} onClick={onDismiss}>
        {t('dismiss')}
      </Button>
    </div>
  );
}
