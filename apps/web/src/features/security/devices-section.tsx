'use client';

import {
  ApiError,
  getListMyDevicesQueryKey,
  useListMyDevices,
  useUntrustMyDevice,
} from '@classloom/api-client';
import { type MyDevices, myDevicesSchema } from '@classloom/contracts';
import { StatusPill } from '@classloom/ui/components/status-pill';
import { Button } from '@classloom/ui/components/ui/button';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { BUTTON_CLASS } from '../auth/auth-ui';
import { securityErrorOf } from './security-errors';
import {
  keepFocusInSection,
  LoadState,
  SectionCard,
  useErrorText,
  useSecurityDates,
} from './security-ui';

/** Devices whose trust has not run out, from `GET /me/devices`. */
const trusted = (devices: MyDevices['devices'], now: number) =>
  devices.filter((device) => device.trustedUntil && Date.parse(device.trustedUntil) > now);

/** Devices that skip the app code; "Remove" asks for it there again. */
export function DevicesSection({ onChanged }: { onChanged: () => void }) {
  const t = useTranslations('account.security.devices');
  const dates = useSecurityDates();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const devices = useListMyDevices({
    query: {
      select: (data): MyDevices['devices'] =>
        trusted(myDevicesSchema.parse(data).devices, Date.now()),
    },
  });
  const untrust = useUntrustMyDevice();

  async function remove(id: string) {
    try {
      await untrust.mutateAsync({ id });
      toast.add({ title: t('removed'), type: 'success' });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        toast.add({ title: errorText(securityErrorOf(error)), type: 'error' });
      }
    }
    await queryClient.invalidateQueries({ queryKey: getListMyDevicesQueryKey() });
    keepFocusInSection('devices');
    onChanged();
  }

  const list = devices.data;

  return (
    <SectionCard id="devices" title={t('title')} description={t('description')}>
      {!list ? (
        <LoadState isError={devices.isError} onRetry={() => void devices.refetch()} />
      ) : list.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      ) : (
        <ul className="divide-border flex flex-col divide-y">
          {list.map((device) => {
            const removing = untrust.isPending && untrust.variables?.id === device.id;
            return (
              <li
                key={device.id}
                className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {device.label}
                    {device.current ? <StatusPill tone="info">{t('thisDevice')}</StatusPill> : null}
                  </p>
                  <p className="text-muted-foreground">
                    {t('lastUsed', { date: dates.dateTime(device.lastSeenAt) })} ·{' '}
                    {t('trustedUntil', {
                      date: dates.day(device.trustedUntil ?? device.lastSeenAt),
                    })}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className={BUTTON_CLASS}
                  disabled={removing}
                  aria-label={t('removeLabel', { device: device.label })}
                  onClick={() => void remove(device.id)}
                >
                  {removing ? <Spinner aria-hidden="true" /> : null}
                  {t('remove')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
