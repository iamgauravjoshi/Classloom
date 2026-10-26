'use client';

import type { SchoolRegistrationRequest } from '@classloom/contracts';
import { useSyncExternalStore } from 'react';

export const DRAFT_STORAGE_KEY = 'classloom.registration-draft.v1';

/** Raw form values kept between steps. The terms acceptance is deliberately never persisted. */
export type RegistrationDraft = Partial<Omit<SchoolRegistrationRequest, 'acceptTerms'>>;

const EMPTY: RegistrationDraft = {};

// Fallback for browsers where sessionStorage throws (private mode, blocked site data, quota).
let memoryDraft: RegistrationDraft = EMPTY;
let cache: { key: string; draft: RegistrationDraft } = { key: '{}', draft: EMPTY };
const listeners = new Set<() => void>();

function readStored(): RegistrationDraft {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (raw === null) return memoryDraft;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // fall back to memory
  }
  return memoryDraft;
}

/** Stable reference while the stored draft is unchanged, as `useSyncExternalStore` requires. */
function getSnapshot(): RegistrationDraft {
  const draft = readStored();
  const key = JSON.stringify(draft);
  if (key !== cache.key) cache = { key, draft };
  return cache.draft;
}

const getServerSnapshot = (): RegistrationDraft => EMPTY;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const notify = () => listeners.forEach((listener) => listener());

function write(draft: RegistrationDraft): void {
  memoryDraft = draft;
  try {
    if (Object.keys(draft).length === 0) window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    else window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // the in-memory copy is already updated
  }
  notify();
}

const save = (values: RegistrationDraft & { acceptTerms?: unknown }): void => {
  const { acceptTerms: _ignored, ...rest } = values;
  write({ ...getSnapshot(), ...rest });
};

const clear = (): void => write(EMPTY);

const subscribeNever = () => () => undefined;

export interface RegistrationDraftApi {
  draft: RegistrationDraft;
  /** False during server render and hydration, true once the stored draft can be read. */
  hydrated: boolean;
  save: (values: RegistrationDraft & { acceptTerms?: unknown }) => void;
  clear: () => void;
}

export function useRegistrationDraft(): RegistrationDraftApi {
  const draft = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  return { draft, hydrated, save, clear };
}
