import { useCallback, useSyncExternalStore } from 'react';

/** Saved after each successful sign-in, so the next visit opens on the credentials step. */
export const SCHOOL_STORAGE_KEY = 'classloom.schoolCode';

const listeners = new Set<() => void>();
// Holds the code for this page's lifetime when storage is blocked (private mode, policies).
let memory: string | null = null;

/** The saved school code, or null; never throws (storage can be blocked or full). */
export function readRememberedSchool(): string | null {
  try {
    return window.localStorage.getItem(SCHOOL_STORAGE_KEY);
  } catch {
    return memory;
  }
}

function write(code: string | null): void {
  memory = code;
  try {
    if (code === null) window.localStorage.removeItem(SCHOOL_STORAGE_KEY);
    else window.localStorage.setItem(SCHOOL_STORAGE_KEY, code);
  } catch {
    // Storage blocked: the in-memory copy is all there is.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab signing in to a different school updates this one too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === SCHOOL_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The school code remembered on this device (`localStorage`, key `classloom.schoolCode`). */
export function useRememberedSchool(): {
  code: string | null;
  remember: (code: string) => void;
  forget: () => void;
} {
  // `null` on the server and during hydration; the stored value right after.
  const code = useSyncExternalStore(subscribe, readRememberedSchool, () => null);
  const remember = useCallback((value: string) => write(value), []);
  const forget = useCallback(() => write(null), []);
  return { code, remember, forget };
}
