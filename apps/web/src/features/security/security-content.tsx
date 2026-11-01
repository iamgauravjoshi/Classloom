'use client';

import { useQueryClient } from '@tanstack/react-query';

import { useMe } from '../account/use-me';
import { activityQueryKey, ActivitySection } from './activity-section';
import { DevicesSection } from './devices-section';
import { useReauth } from './security-ui';
import { SessionsSection } from './sessions-section';
import { TwoFactorSection } from './two-factor-section';

/** The Security page: two-step sign-in, sessions, trusted devices and the sign-in history. */
export function SecurityContent({ schoolCode }: { schoolCode: string }) {
  const { reauth } = useReauth(schoolCode);
  const queryClient = useQueryClient();
  // The recovery-codes file names the account; until `GET /me` answers it is left blank.
  const { data: me } = useMe();
  // Ending sessions and removing devices are recorded in the history.
  const reloadHistory = () => void queryClient.invalidateQueries({ queryKey: activityQueryKey() });

  return (
    <div className="flex flex-col gap-6">
      <TwoFactorSection email={me?.email ?? ''} onReauth={reauth} />
      <SessionsSection onEnded={reloadHistory} />
      <DevicesSection onChanged={reloadHistory} />
      <ActivitySection />
    </div>
  );
}
