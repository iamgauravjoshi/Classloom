'use client';

import { useGetHealth } from '@classloom/api-client';
import { StatusPill } from '@classloom/ui/components/status-pill';
import { useTranslations } from 'next-intl';

/** Live API connectivity pill, polled every 30 seconds. */
export function ApiStatus() {
  const t = useTranslations('api');
  const { data, isPending } = useGetHealth({ query: { refetchInterval: 30_000 } });

  if (isPending) return <StatusPill tone="neutral">{t('checking')}</StatusPill>;
  return data?.status === 'ok' ? (
    <StatusPill tone="success">{t('online')}</StatusPill>
  ) : (
    <StatusPill tone="danger">{t('offline')}</StatusPill>
  );
}
