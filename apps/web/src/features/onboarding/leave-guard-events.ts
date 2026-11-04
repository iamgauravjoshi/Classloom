/** A link click this page may hold back: same tab, same origin, no modifier keys. */
export function leavingHref(event: MouseEvent): string | null {
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
 * The `beforeunload` handler while edits are unsaved: the browser asks before the tab closes or
 * reloads. Current browsers need `preventDefault`; older ones still need `returnValue` set.
 */
export function holdUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  // Deprecated, but the only signal some browsers still read.
  event.returnValue = '';
}
