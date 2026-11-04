'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { ConfirmDialog } from '../school-settings/years-list';
import { holdUnload, leavingHref } from './leave-guard-events';

/**
 * Asks before unsaved edits are lost (spec §9, "Leaving early"). While `dirty`:
 * - closing or reloading the tab gets the browser's own question;
 * - following a link anywhere in the app (the sidebar, the top bar) asks first;
 * - `guard(action)` asks before an in-page move, such as the wizard's Back, Skip or stepper.
 * The returned `dialog` must be rendered.
 */
export function useLeaveGuard(dirty: boolean): {
  guard: (action: () => void) => void;
  dialog: ReactNode;
} {
  const t = useTranslations('onboarding.leave');
  const router = useRouter();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent) => {
      const href = leavingHref(event);
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(() => () => router.push(href));
    };
    window.addEventListener('beforeunload', holdUnload);
    // Capture, so the app's own link handlers never see a click we hold back.
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', holdUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, router]);

  const guard = useCallback((action: () => void) => {
    if (dirtyRef.current) setPending(() => action);
    else action();
  }, []);

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={t('title')}
      body={t('body')}
      action={t('leave')}
      pendingLabel={t('leave')}
      cancelLabel={t('stay')}
      destructive
      pending={false}
      errorText={null}
      onConfirm={() => {
        const action = pending;
        setPending(null);
        dirtyRef.current = false;
        action?.();
      }}
      onClose={() => setPending(null)}
    />
  );

  return { guard, dialog };
}
