// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SCHOOL_STORAGE_KEY, useRememberedSchool } from './use-remembered-school';

afterEach(() => {
  vi.restoreAllMocks();
  // Also resets the in-memory fallback the hook keeps when storage is blocked.
  const { result } = renderHook(() => useRememberedSchool());
  act(() => result.current.forget());
  window.localStorage.clear();
});

describe('useRememberedSchool', () => {
  it('uses the classloom.schoolCode key', () => {
    expect(SCHOOL_STORAGE_KEY).toBe('classloom.schoolCode');
  });

  it('is null when nothing is saved', () => {
    const { result } = renderHook(() => useRememberedSchool());
    expect(result.current.code).toBeNull();
  });

  it('reads a code saved earlier', () => {
    window.localStorage.setItem(SCHOOL_STORAGE_KEY, 'GISD');
    const { result } = renderHook(() => useRememberedSchool());
    expect(result.current.code).toBe('GISD');
  });

  it('remember writes the key and updates the hook', () => {
    const { result } = renderHook(() => useRememberedSchool());
    act(() => result.current.remember('GISD'));
    expect(window.localStorage.getItem(SCHOOL_STORAGE_KEY)).toBe('GISD');
    expect(result.current.code).toBe('GISD');
  });

  it('forget removes the key', () => {
    window.localStorage.setItem(SCHOOL_STORAGE_KEY, 'GISD');
    const { result } = renderHook(() => useRememberedSchool());
    act(() => result.current.forget());
    expect(window.localStorage.getItem(SCHOOL_STORAGE_KEY)).toBeNull();
    expect(result.current.code).toBeNull();
  });

  it('survives a localStorage that throws (blocked storage, private mode)', () => {
    const blocked = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked);

    const { result } = renderHook(() => useRememberedSchool());
    expect(result.current.code).toBeNull();
    expect(() => act(() => result.current.remember('GISD'))).not.toThrow();
    // Kept in memory for the rest of this page's life.
    expect(result.current.code).toBe('GISD');
    expect(() => act(() => result.current.forget())).not.toThrow();
    expect(result.current.code).toBeNull();
  });
});
