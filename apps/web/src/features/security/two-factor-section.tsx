'use client';

import {
  getGetTwoFactorStatusQueryKey,
  getListMyDevicesQueryKey,
  useGetTwoFactorStatus,
} from '@classloom/api-client';
import { type TwoFactorStatus, twoFactorStatusSchema } from '@classloom/contracts';
import { StatusPill } from '@classloom/ui/components/status-pill';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { toast } from '@classloom/ui/components/ui/toast';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { activityQueryKey } from './activity-section';
import { LoadState, SectionCard, useSecurityDates } from './security-ui';
import { TwoFactorCodeDialog } from './two-factor-code-dialog';
import { TwoFactorSetupDialog } from './two-factor-setup-dialog';

const TITLE_ID = 'two-factor';

/** Moves focus to the section's heading once its buttons were swapped by a refetch. */
function focusTitle() {
  requestAnimationFrame(() => document.getElementById(`${TITLE_ID}-title`)?.focus());
}

interface TwoFactorSectionProps {
  email: string;
  onReauth: () => void;
}

/** Off: the explanation and "Turn on". On: since when, codes left, "New recovery codes", "Turn off". */
export function TwoFactorSection({ email, onReauth }: TwoFactorSectionProps) {
  const t = useTranslations('account.security.twoFactor');
  const dates = useSecurityDates();
  const queryClient = useQueryClient();
  const status = useGetTwoFactorStatus({
    query: { select: (data): TwoFactorStatus => twoFactorStatusSchema.parse(data) },
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetTwoFactorStatusQueryKey() }),
      // Turning two-step off clears every device's trust.
      queryClient.invalidateQueries({ queryKey: getListMyDevicesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: activityQueryKey() }),
    ]);
  }

  const data = status.data;
  const pill = data ? (
    <StatusPill tone={data.enabled ? 'success' : 'neutral'}>
      {data.enabled ? t('on') : t('off')}
    </StatusPill>
  ) : undefined;

  return (
    <SectionCard id={TITLE_ID} title={t('title')} action={pill}>
      {!data ? (
        <LoadState isError={status.isError} onRetry={() => void status.refetch()} />
      ) : data.enabled ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 text-sm">
            {data.enabledAt ? <p>{t('onSince', { date: dates.day(data.enabledAt) })}</p> : null}
            <p>{t('codesLeft', { count: data.recoveryCodesLeft })}</p>
          </div>
          {data.recoveryCodesLeft === 0 ? (
            <Alert variant="destructive">
              <AlertDescription>{t('noCodesWarning')}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <TwoFactorCodeDialog
              mode="regenerate"
              email={email}
              triggerLabel={t('newCodes')}
              onReauth={onReauth}
              onChanged={() => void refresh()}
            />
            <TwoFactorCodeDialog
              mode="disable"
              email={email}
              triggerLabel={t('turnOff')}
              triggerVariant="destructive"
              onReauth={onReauth}
              onChanged={() => void refresh().then(focusTitle)}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-4">
          <p className="text-muted-foreground text-sm">{t('offDescription')}</p>
          <TwoFactorSetupDialog
            email={email}
            onReauth={onReauth}
            onEnabled={() => {
              toast.add({ title: t('turnedOn'), type: 'success' });
              void refresh().then(focusTitle);
            }}
          />
        </div>
      )}
    </SectionCard>
  );
}
