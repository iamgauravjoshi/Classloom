import type { LoginActivityEvent } from '@classloom/contracts';

type EventType = LoginActivityEvent['type'];
type EventMethod = LoginActivityEvent['method'];

/** Events whose label names how the person signed in. */
const WITH_METHOD: ReadonlySet<EventType> = new Set(['SIGN_IN_SUCCEEDED', 'SIGN_IN_FAILED']);

/** The message key (under `account.security.activity`) for a sign-in history row. */
export function eventLabelKey(type: EventType, method: EventMethod): string {
  if (WITH_METHOD.has(type)) return `events.${type}.${method ?? 'OTHER'}`;
  return `events.${type}`;
}
