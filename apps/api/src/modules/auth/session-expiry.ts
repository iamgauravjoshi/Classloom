const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const REMEMBER_WINDOW = 30 * DAY;
/** A remembered session never outlives sign-in + 90 days, however active. */
const REMEMBER_CAP = 90 * DAY;
const TEMPORARY_ABSOLUTE = 12 * HOUR;
const TEMPORARY_IDLE = 2 * HOUR;
/** `last_seen_at` (and the slid expiry) are written at most this often. */
export const TOUCH_INTERVAL = 5 * MINUTE;

export interface Expiry {
  expiresAt: Date;
  idleExpiresAt: Date | null;
}

export function initialExpiry(now: Date, remember: boolean): Expiry {
  if (remember) {
    return { expiresAt: new Date(now.getTime() + REMEMBER_WINDOW), idleExpiresAt: null };
  }
  return {
    expiresAt: new Date(now.getTime() + TEMPORARY_ABSOLUTE),
    idleExpiresAt: new Date(now.getTime() + TEMPORARY_IDLE),
  };
}

export interface SlidableSession extends Expiry {
  remember: boolean;
  authenticatedAt: Date;
  /** When omitted it is derived from the expiry, which is exact except for a capped session. */
  lastSeenAt?: Date;
}

function lastSeen(session: SlidableSession): number {
  if (session.lastSeenAt) return session.lastSeenAt.getTime();
  if (session.remember) return session.expiresAt.getTime() - REMEMBER_WINDOW;
  return (session.idleExpiresAt ?? session.expiresAt).getTime() - TEMPORARY_IDLE;
}

/**
 * The new expiry after activity at `now`, or null when the last touch was less than 5 minutes
 * ago. Remembered: last seen + 30 days, capped at sign-in + 90 days. Not remembered: only the
 * idle expiry moves; the 12-hour absolute expiry stays.
 */
export function slidExpiry(session: SlidableSession, now: Date): Expiry | null {
  if (now.getTime() - lastSeen(session) < TOUCH_INTERVAL) return null;
  if (session.remember) {
    const slid = now.getTime() + REMEMBER_WINDOW;
    const cap = session.authenticatedAt.getTime() + REMEMBER_CAP;
    return { expiresAt: new Date(Math.min(slid, cap)), idleExpiresAt: null };
  }
  return {
    expiresAt: session.expiresAt,
    idleExpiresAt: new Date(now.getTime() + TEMPORARY_IDLE),
  };
}

/** Expired at either boundary: the instant itself already counts as expired. */
export function isExpired(session: Expiry, now: Date): boolean {
  if (now.getTime() >= session.expiresAt.getTime()) return true;
  return session.idleExpiresAt !== null && now.getTime() >= session.idleExpiresAt.getTime();
}
