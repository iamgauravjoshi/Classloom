/** A base32 key as people copy it by hand: groups of four, separated by spaces. */
export function groupKey(key: string): string {
  return (key.match(/.{1,4}/g) ?? []).join(' ');
}

// Indian English: "2 Nov 2026", as the Security page's copy is written.
const DATE_LOCALE = 'en-IN';

/** "2 Nov 2026". */
export function formatDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/** "2 Nov 2026, 1:30 am". */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}
