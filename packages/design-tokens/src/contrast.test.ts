import { describe, expect, it } from 'vitest';

import { contrastRatio } from './contrast';
import { semantic, STATUS_HUES } from './semantic';

const AA = 4.5;
const UI = 3;

describe('contrastRatio', () => {
  it('matches the WCAG formula for a known pair', () => {
    expect(contrastRatio('#FFFFFF', '#3D5EE1')).toBeCloseTo(5.4, 1);
  });

  it('is symmetric and maxes out at 21 for black on white', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  });
});

describe.each(['light', 'dark'] as const)('%s semantic tokens', (mode) => {
  const s = semantic[mode];

  it('body text meets AA on canvas and cards', () => {
    expect(contrastRatio(s.foreground, s.background)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(s.foreground, s.card)).toBeGreaterThanOrEqual(AA);
  });

  it('muted text meets AA on canvas and cards', () => {
    expect(contrastRatio(s['muted-foreground'], s.background)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(s['muted-foreground'], s.card)).toBeGreaterThanOrEqual(AA);
  });

  it('subtle (placeholder) text meets AA on cards', () => {
    expect(contrastRatio(s['subtle-foreground'], s.card)).toBeGreaterThanOrEqual(AA);
  });

  it('primary buttons, links and destructive buttons meet AA', () => {
    expect(contrastRatio(s['primary-foreground'], s.primary)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(s['primary-text'], s.card)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(s['primary-text'], s.accent)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(s['destructive-foreground'], s.destructive)).toBeGreaterThanOrEqual(AA);
  });

  it('focus ring is visible against cards', () => {
    expect(contrastRatio(s.ring, s.card)).toBeGreaterThanOrEqual(UI);
  });

  it.each(STATUS_HUES)('%s-strong text meets AA on its tint', (hue) => {
    expect(contrastRatio(s[`${hue}-strong`], s[`${hue}-tint`])).toBeGreaterThanOrEqual(AA);
  });
});

describe.each(['light', 'dark'] as const)('%s component pairs', (mode) => {
  const s = semantic[mode];

  // WCAG 1.4.11: a text input's border is what identifies it, so it needs 3:1.
  it('input borders meet 3:1 on cards and canvas', () => {
    expect(contrastRatio(s.input, s.card)).toBeGreaterThanOrEqual(UI);
    expect(contrastRatio(s.input, s.background)).toBeGreaterThanOrEqual(UI);
  });

  // Destructive menu items and ghost-style buttons put danger text straight on the card.
  it.each(STATUS_HUES)('%s-strong text meets AA on cards', (hue) => {
    expect(contrastRatio(s[`${hue}-strong`], s.card)).toBeGreaterThanOrEqual(AA);
  });
});
