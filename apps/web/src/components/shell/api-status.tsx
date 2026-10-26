'use client';

import { useGetHealth } from '@classloom/api-client';
import { StatusPill, type StatusTone } from '@classloom/ui/components/status-pill';
import { useTranslations } from 'next-intl';

import { type ApiStatusTone, apiStatusTone } from '@/lib/api-status';

const PILL_TONE: Record<ApiStatusTone, StatusTone> = {
  checking: 'neutral',
  online: 'success',
  offline: 'danger',
};

/** Live API connectivity pill, polled every 30 seconds. */
export function ApiStatus() {
  const t = useTranslations('api');
  const query = useGetHealth({ query: { refetchInterval: 30_000 } });
  const tone = apiStatusTone(query);
  return <StatusPill tone={PILL_TONE[tone]}>{t(tone)}</StatusPill>;
}
