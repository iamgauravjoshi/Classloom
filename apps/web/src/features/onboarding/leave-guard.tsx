'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { ConfirmDialog } from '../school-settings/years-list';

/** A link click this page may hold back: same tab, same origin, no modifier keys. */
function leavingHref(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = (event.target as Element | null)?.closest?.('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.target && anchor.target !== '_self') return null;
  if (anchor.hasAttribute('download')) return null;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  if (url.pathname === window.location.pathname && url.search === window.location.search) {
    return null;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

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
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      const href = leavingHref(event);
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(() => () => router.push(href));
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    // Capture, so the app's own link handlers never see a click we hold back.
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
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
