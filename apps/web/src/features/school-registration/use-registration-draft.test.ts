// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DRAFT_STORAGE_KEY, useRegistrationDraft } from './use-registration-draft';

const values = {
  schoolName: 'Global International School',
  city: 'Dehradun',
  board: 'CBSE',
} as const;

afterEach(() => {
  const { result } = renderHook(() => useRegistrationDraft());
  act(() => result.current.clear());
  window.sessionStorage.clear();
});

describe('useRegistrationDraft', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useRegistrationDraft());
    expect(result.current.draft).toEqual({});
  });

  it('returns a saved draft to a fresh hook (reload)', () => {
    const first = renderHook(() => useRegistrationDraft());
    act(() => first.result.current.save(values));
    first.unmount();

    const second = renderHook(() => useRegistrationDraft());
    expect(second.result.current.draft).toEqual(values);
    expect(window.sessionStorage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull();
  });

  it('merges successive saves', () => {
    const { result } = renderHook(() => useRegistrationDraft());
    act(() => result.current.save({ city: 'Pune' }));
    act(() => result.current.save({ board: 'ICSE' }));
    expect(result.current.draft).toEqual({ city: 'Pune', board: 'ICSE' });
  });

  it('clear empties the draft and the storage', () => {
    const { result } = renderHook(() => useRegistrationDraft());
    act(() => result.current.save(values));
    act(() => result.current.clear());
    expect(result.current.draft).toEqual({});
    expect(window.sessionStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    expect(renderHook(() => useRegistrationDraft()).result.current.draft).toEqual({});
  });

  it('keeps the draft in memory when sessionStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const { result } = renderHook(() => useRegistrationDraft());
    expect(() => act(() => result.current.save(values))).not.toThrow();
    expect(result.current.draft).toEqual(values);
  });

  it('ignores a corrupt stored draft', () => {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, '{not json');
    const { result } = renderHook(() => useRegistrationDraft());
    expect(result.current.draft).toEqual({});
  });

  it('never stores the acceptance of the terms', () => {
    const { result } = renderHook(() => useRegistrationDraft());
    act(() => result.current.save({ ...values, email: 'a@b.in', acceptTerms: true }));
    expect(window.sessionStorage.getItem(DRAFT_STORAGE_KEY)).not.toContain('acceptTerms');
  });
});
