import { describe, expect, it } from 'vitest';

import { deviceLabel } from './device-label';

describe('deviceLabel', () => {
  it('labels Chrome on Windows', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome on Windows');
  });

  it('labels Safari on iPhone', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iOS');
  });

  it('labels Firefox on Android', () => {
    expect(
      deviceLabel('Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0'),
    ).toBe('Firefox on Android');
  });

  it('falls back to Unknown device', () => {
    expect(deviceLabel(null)).toBe('Unknown device');
    expect(deviceLabel('')).toBe('Unknown device');
    expect(deviceLabel('???')).toBe('Unknown device');
  });
});
