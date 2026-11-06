import { describe, expect, it } from 'vitest';

import { deviceOf } from './device';

describe('deviceOf', () => {
  it.each([
    [
      'Chrome on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ],
    [
      'Safari on iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    ],
    [
      'Safari on iPad',
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    ],
    ['Firefox on Android', 'Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0'],
    [
      'Safari on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    ],
  ])('reads %s', (expected, userAgent) => {
    expect(deviceOf(userAgent)).toBe(expected);
  });

  it('is null for an agent it cannot read', () => {
    expect(deviceOf('curl/8.4.0')).toBeNull();
    expect(deviceOf('')).toBeNull();
  });

  it('is null without an agent', () => {
    expect(deviceOf(null)).toBeNull();
  });
});
