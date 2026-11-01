'use client';

import {
  ApiError,
  getListMySessionsQueryKey,
  useListMySessions,
  useRevokeMyOtherSessions,
  useRevokeMySession,
} from '@classloom/api-client';
import { type MySessions, mySessionsSchema } from '@classloom/contracts';
import { StatusPill } from '@classloom/ui/components/status-pill';
import { Button } from '@classloom/ui/components/ui/button';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { BUTTON_CLASS } from '../auth/auth-ui';
import { securityErrorOf } from './security-errors';
import { LoadState, SectionCard, useErrorText, useSecurityDates } from './security-ui';

/** Live sessions across all the person's schools; "End" one, or "End all other sessions". */
export function SessionsSection({ onEnded }: { onEnded: () => void }) {
  const t = useTranslations('account.security.sessions');
  const dates = useSecurityDates();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const sessions = useListMySessions({
    query: { select: (data): MySessions => mySessionsSchema.parse(data) },
  });
  const revoke = useRevokeMySession();
  const revokeOthers = useRevokeMyOtherSessions();

  async function after(promise: Promise<void>, done: string) {
    try {
      await promise;
      toast.add({ title: done, type: 'success' });
    } catch (error) {
      // A 404 is a session that already ended: the refreshed list shows it gone.
      if (!(error instanceof ApiError && error.status === 404)) {
        toast.add({ title: errorText(securityErrorOf(error)), type: 'error' });
      }
    }
    await queryClient.invalidateQueries({ queryKey: getListMySessionsQueryKey() });
    onEnded();
  }

  const list = sessions.data?.sessions;
  const hasOthers = list?.some((session) => !session.current) ?? false;

  return (
    <SectionCard
      id="sessions"
      title={t('title')}
      description={t('description')}
      action={
        hasOthers ? (
          <Button
            variant="outline"
            className={BUTTON_CLASS}
            disabled={revokeOthers.isPending}
            onClick={() => void after(revokeOthers.mutateAsync(), t('othersEnded'))}
          >
            {revokeOthers.isPending ? <Spinner aria-hidden="true" /> : null}
            {t('endOthers')}
          </Button>
        ) : undefined
      }
    >
      {!list ? (
        <LoadState isError={sessions.isError} onRetry={() => void sessions.refetch()} />
      ) : (
        <ul className="divide-border flex flex-col divide-y">
          {list.map((session) => {
            const ending = revoke.isPending && revoke.variables?.id === session.id;
            return (
              <li
                key={session.id}
                className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {session.device}
                    {session.current ? (
                      <StatusPill tone="info">{t('thisDevice')}</StatusPill>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground">
                    {session.school.name} ·{' '}
                    {session.ip ? t('ip', { ip: session.ip }) : t('unknownIp')}
                  </p>
                  <p className="text-muted-foreground">
                    {t('signedIn', { date: dates.dateTime(session.signedInAt) })} ·{' '}
                    {t('lastActive', { date: dates.dateTime(session.lastSeenAt) })}
                  </p>
                </div>
                {session.current ? null : (
                  <Button
                    variant="outline"
                    className={BUTTON_CLASS}
                    disabled={ending}
                    aria-label={t('endLabel', {
                      device: session.device,
                      school: session.school.name,
                    })}
                    onClick={() => void after(revoke.mutateAsync({ id: session.id }), t('ended'))}
                  >
                    {ending ? <Spinner aria-hidden="true" /> : null}
                    {t('end')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
