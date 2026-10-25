import { describe, expect, it } from 'vitest';

import { buildTokensCss } from './css';
import { BASE_TOKENS, semantic, STATUS_HUES } from './semantic';

const css = buildTokensCss();

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('buildTokensCss', () => {
  it('declares light semantic values on :root', () => {
    expect(block(':root')).toContain('--primary: #3D5EE1;');
    expect(block(':root')).toContain('--muted-foreground: #515B73;');
  });

  it('declares dark semantic values on .dark', () => {
    expect(block('.dark')).toContain('--background: #0F0C1C;');
    expect(block('.dark')).toContain(`--primary-text: ${semantic.dark['primary-text']};`);
  });

  it('exposes every semantic token as a Tailwind colour', () => {
    const theme = block('@theme inline');
    for (const token of [
      ...BASE_TOKENS,
      ...STATUS_HUES.flatMap((h) => [`${h}-tint`, `${h}-strong`]),
    ]) {
      expect(theme).toContain(`--color-${token}: var(--${token});`);
    }
  });

  it('exposes raw ramps, the radius scale and the Figma type scale', () => {
    const theme = block('@theme inline');
    expect(theme).toContain('--color-grey-700: #515B73;');
    expect(theme).toContain('--radius-md: var(--radius);');
    expect(theme).toContain('--text-h1: 1.75rem;');
    expect(theme).toContain('--text-h1--font-weight: 700;');
    expect(block(':root')).toContain('--radius: 0.375rem;');
  });

  it('matches the committed tokens.css (run `pnpm tokens:css` after changing tokens)', async () => {
    await expect(css).toMatchFileSnapshot('./tokens.css');
  });
});
