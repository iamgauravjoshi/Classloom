'use client';

import { getListMyLoginActivityQueryKey, listMyLoginActivity } from '@classloom/api-client';
import { type LoginActivityEvent, loginActivityPageSchema } from '@classloom/contracts';
import { Button } from '@classloom/ui/components/ui/button';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { BUTTON_CLASS } from '../auth/auth-ui';
import { eventLabelKey } from './event-labels';
import { LoadState, SectionCard, useSecurityDates } from './security-ui';

/** The key every page of the history lives under; invalidating it reloads from the newest. */
export const activityQueryKey = () => [...getListMyLoginActivityQueryKey(), 'infinite'] as const;

/** Sign-in history, newest first, 20 at a time: a table from `md` up, cards below. */
export function ActivitySection() {
  const t = useTranslations('account.security.activity');
  const dates = useSecurityDates();
  const history = useInfiniteQuery({
    queryKey: activityQueryKey(),
    queryFn: async ({ pageParam, signal }) =>
      loginActivityPageSchema.parse(
        await listMyLoginActivity(pageParam ? { cursor: pageParam } : undefined, signal),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });

  const events = history.data?.pages.flatMap((page) => page.events);
  const label = (event: LoginActivityEvent) => t(eventLabelKey(event.type, event.method));
  const school = (event: LoginActivityEvent) => event.school?.name ?? t('noSchool');
  const ip = (event: LoginActivityEvent) => event.ip ?? t('unknownIp');

  return (
    <SectionCard id="activity" title={t('title')} description={t('description')}>
      {!events ? (
        <LoadState isError={history.isError} onRetry={() => void history.refetch()} />
      ) : events.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <table className="hidden w-full text-left text-sm md:table">
            <caption className="sr-only">{t('caption')}</caption>
            <thead className="text-muted-foreground border-border border-b">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t('event')}
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t('when')}
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t('school')}
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t('device')}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t('ip')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="py-2 pr-4 font-medium">{label(event)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{dates.dateTime(event.at)}</td>
                  <td className="py-2 pr-4">{school(event)}</td>
                  <td className="py-2 pr-4">{event.device}</td>
                  <td className="py-2 font-mono text-xs">{ip(event)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-border flex flex-col divide-y md:hidden" aria-label={t('caption')}>
            {events.map((event) => (
              <li key={event.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0">
                <p className="font-medium">{label(event)}</p>
                <p className="text-muted-foreground">{dates.dateTime(event.at)}</p>
                <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-2">
                  <dt>{t('school')}</dt>
                  <dd>{school(event)}</dd>
                  <dt>{t('device')}</dt>
                  <dd>{event.device}</dd>
                  <dt>{t('ip')}</dt>
                  <dd className="font-mono text-xs leading-5 break-all">{ip(event)}</dd>
                </dl>
              </li>
            ))}
          </ul>
          {history.hasNextPage ? (
            <Button
              variant="outline"
              className={`${BUTTON_CLASS} self-start`}
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {history.isFetchingNextPage ? <Spinner aria-hidden="true" /> : null}
              {history.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
            </Button>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
