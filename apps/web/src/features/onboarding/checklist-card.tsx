'use client';

import {
  getGetOnboardingQueryKey,
  type OnboardingResponseDto,
  useDismissOnboarding,
  useGetOnboarding,
} from '@classloom/api-client';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button } from '@classloom/ui/components/ui/button';
import { Card, CardContent, CardHeader } from '@classloom/ui/components/ui/card';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { cn } from '@classloom/ui/lib/utils';
import { IconChevronRight, IconCircleCheckFilled, IconCircleDashed } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Link } from '@/i18n/navigation';

import { BUTTON_CLASS } from '../auth/auth-ui';

/**
 * The dashboard's setup checklist (spec §9): a progress count, each item linking to its wizard
 * step, and "Dismiss". It shows only while the API says `visible` (someone who manages settings,
 * something left to do, not dismissed). The server's answer is the starting data.
 */
export function ChecklistCard({ initial }: { initial: OnboardingResponseDto }) {
  const t = useTranslations('onboarding.checklist');
  const queryClient = useQueryClient();
  const { data } = useGetOnboarding({ query: { initialData: initial } });
  const dismiss = useDismissOnboarding();
  const [failed, setFailed] = useState(false);
  const id = useId();

  if (!data.visible) return null;
  const doneCount = data.items.filter((item) => item.done).length;
  const total = data.items.length;

  async function onDismiss() {
    setFailed(false);
    try {
      await dismiss.mutateAsync();
      queryClient.setQueryData<OnboardingResponseDto>(getGetOnboardingQueryKey(), (old) =>
        old ? { ...old, visible: false, dismissedAt: new Date().toISOString() } : old,
      );
    } catch {
      setFailed(true);
    }
  }

  return (
    <section aria-labelledby={`${id}-title`}>
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id={`${id}-title`} className="text-h5">
              {t('title')}
            </h2>
            <p className="text-muted-foreground text-sm" id={`${id}-progress`}>
              {t('progress', { done: doneCount, total })}
            </p>
          </div>
          <Button
            variant="outline"
            className={BUTTON_CLASS}
            disabled={dismiss.isPending}
            onClick={() => void onDismiss()}
          >
            {dismiss.isPending ? <Spinner aria-hidden="true" /> : null}
            {dismiss.isPending ? t('dismissing') : t('dismiss')}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div
            role="progressbar"
            aria-labelledby={`${id}-progress`}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={doneCount}
            className="bg-muted h-2 overflow-hidden rounded-full"
          >
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${total === 0 ? 0 : (doneCount / total) * 100}%` }}
            />
          </div>
          {failed ? (
            <Alert variant="destructive">
              <AlertDescription role="alert">{t('dismissError')}</AlertDescription>
            </Alert>
          ) : null}
          <ul className="flex flex-col gap-1">
            {data.items.map((item) => (
              <li key={item.key}>
                <Link
                  href={`/onboarding?step=${item.key}`}
                  className="hover:bg-muted focus-visible:ring-ring/50 flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 outline-none focus-visible:ring-[3px]"
                >
                  {item.done ? (
                    <IconCircleCheckFilled
                      aria-hidden="true"
                      className="text-success-strong size-5 shrink-0"
                    />
                  ) : (
                    <IconCircleDashed
                      aria-hidden="true"
                      className="text-muted-foreground size-5 shrink-0"
                    />
                  )}
                  <span className={cn('min-w-0 flex-1', item.done && 'text-muted-foreground')}>
                    {t(`items.${item.key}`)}
                    <span className="sr-only"> ({item.done ? t('done') : t('todo')})</span>
                  </span>
                  <IconChevronRight
                    aria-hidden="true"
                    className="text-muted-foreground size-4 shrink-0"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
