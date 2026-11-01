import { useCallback, useSyncExternalStore } from 'react';

/** Re-reads the clock four times a second, so the shown number is never more than 250 ms late. */
const TICK_MS = 250;

const secondsUntil = (expiresAt: number, now: number) =>
  Math.max(0, Math.ceil((expiresAt - now) / 1000));

/** The wall clock as an external store: React re-reads the snapshot on every tick. */
function subscribeToClock(onTick: () => void): () => void {
  const id = setInterval(onTick, TICK_MS);
  return () => clearInterval(id);
}

/**
 * Whole seconds left until `expiresAt` (epoch milliseconds) and whether it has passed. Rounds up,
 * so it shows 0 only once the moment has come. A new `expiresAt` (a resent code) applies at once.
 */
export function useCountdown(expiresAt: number): { secondsLeft: number; expired: boolean } {
  // A whole number of seconds, so it only changes (and re-renders) once a second.
  const read = useCallback(() => secondsUntil(expiresAt, Date.now()), [expiresAt]);
  const secondsLeft = useSyncExternalStore(subscribeToClock, read, read);
  return { secondsLeft, expired: secondsLeft === 0 };
}

/** `582` → `09:42`. */
export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
