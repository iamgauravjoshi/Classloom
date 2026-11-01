import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initialExpiry, isExpired, slidExpiry } from './session-expiry';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = new Date('2026-10-27T08:00:00.000Z');
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

describe('session expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  describe('initialExpiry', () => {
    it('remembered: 30 days, no idle expiry', () => {
      expect(initialExpiry(new Date(), true)).toEqual({
        expiresAt: at(30 * DAY),
        idleExpiresAt: null,
      });
    });

    it('not remembered: 12 hours absolute and 2 hours idle', () => {
      expect(initialExpiry(new Date(), false)).toEqual({
        expiresAt: at(12 * HOUR),
        idleExpiresAt: at(2 * HOUR),
      });
    });
  });

  describe('slidExpiry', () => {
    const remembered = () => ({
      remember: true,
      authenticatedAt: T0,
      lastSeenAt: T0,
      ...initialExpiry(T0, true),
    });
    const temporary = () => ({
      remember: false,
      authenticatedAt: T0,
      lastSeenAt: T0,
      ...initialExpiry(T0, false),
    });

    it('does nothing within the 5-minute touch interval', () => {
      expect(slidExpiry(remembered(), at(4 * MIN))).toBeNull();
      expect(slidExpiry(temporary(), at(4 * MIN))).toBeNull();
    });

    it('slides a remembered session to last seen + 30 days after 6 minutes', () => {
      expect(slidExpiry(remembered(), at(6 * MIN))).toEqual({
        expiresAt: at(6 * MIN + 30 * DAY),
        idleExpiresAt: null,
      });
    });

    it('never slides a remembered session past sign-in + 90 days', () => {
      const session = { ...remembered(), lastSeenAt: at(80 * DAY) };
      expect(slidExpiry(session, at(80 * DAY + 6 * MIN))).toEqual({
        expiresAt: at(90 * DAY),
        idleExpiresAt: null,
      });
    });

    it('slides only the idle expiry of a session that is not remembered', () => {
      const session = temporary();
      expect(slidExpiry(session, at(6 * MIN))).toEqual({
        expiresAt: session.expiresAt,
        idleExpiresAt: at(6 * MIN + 2 * HOUR),
      });
    });

    it('works without lastSeenAt, deriving it from the expiry', () => {
      const { lastSeenAt: _a, ...remembered4 } = remembered();
      const { lastSeenAt: _b, ...temporary4 } = temporary();
      expect(slidExpiry(remembered4, at(4 * MIN))).toBeNull();
      expect(slidExpiry(remembered4, at(6 * MIN))).not.toBeNull();
      expect(slidExpiry(temporary4, at(4 * MIN))).toBeNull();
      expect(slidExpiry(temporary4, at(6 * MIN))).not.toBeNull();
    });
  });

  describe('isExpired', () => {
    const session = { expiresAt: at(12 * HOUR), idleExpiresAt: at(2 * HOUR) };

    it('is false before both boundaries', () => {
      expect(isExpired(session, at(HOUR))).toBe(false);
    });

    it('is true at the idle boundary', () => {
      expect(isExpired(session, at(2 * HOUR))).toBe(true);
    });

    it('is true at the absolute boundary even when idle is later or absent', () => {
      expect(isExpired({ expiresAt: at(12 * HOUR), idleExpiresAt: null }, at(12 * HOUR))).toBe(
        true,
      );
      expect(isExpired({ expiresAt: at(12 * HOUR), idleExpiresAt: null }, at(12 * HOUR - 1))).toBe(
        false,
      );
    });
  });
});
