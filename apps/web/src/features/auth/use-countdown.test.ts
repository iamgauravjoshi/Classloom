// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatCountdown, useCountdown } from './use-countdown';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-31T10:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCountdown', () => {
  it('counts whole seconds down and reaches expired at 0', () => {
    const expiresAt = Date.now() + 3_000;
    const { result } = renderHook(() => useCountdown(expiresAt));
    expect(result.current).toEqual({ secondsLeft: 3, expired: false });

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toEqual({ secondsLeft: 2, expired: false });

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current).toEqual({ secondsLeft: 0, expired: true });

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current).toEqual({ secondsLeft: 0, expired: true });
  });

  it('rounds a part second up, so it never shows 0 before expiry', () => {
    const expiresAt = Date.now() + 1_500;
    const { result } = renderHook(() => useCountdown(expiresAt));
    expect(result.current.secondsLeft).toBe(2);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toEqual({ secondsLeft: 1, expired: false });
  });

  it('is expired at once for a time in the past', () => {
    const expiresAt = Date.now() - 1;
    const { result } = renderHook(() => useCountdown(expiresAt));
    expect(result.current).toEqual({ secondsLeft: 0, expired: true });
  });

  it('restarts when the expiry moves (a resent code)', () => {
    const start = Date.now();
    const { result, rerender } = renderHook(({ at }) => useCountdown(at), {
      initialProps: { at: start + 2_000 },
    });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.expired).toBe(true);

    rerender({ at: Date.now() + 60_000 });
    expect(result.current).toEqual({ secondsLeft: 60, expired: false });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.secondsLeft).toBe(59);
  });
});

describe('formatCountdown', () => {
  it('formats minutes and seconds as mm:ss', () => {
    expect(formatCountdown(582)).toBe('09:42');
    expect(formatCountdown(600)).toBe('10:00');
    expect(formatCountdown(0)).toBe('00:00');
  });
});
