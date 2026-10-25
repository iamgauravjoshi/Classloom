import {
  BASE_TOKENS,
  contrastRatio,
  palette,
  semantic,
  STATUS_HUES,
  STEPS,
} from '@classloom/design-tokens';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta: Meta = { title: 'Tokens' };
export default meta;

function Swatch({ name, value, note }: { name: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="border-border h-12 rounded-md border" style={{ background: value }} />
      <span className="truncate text-xs font-medium">{name}</span>
      <span className="text-muted-foreground text-xs">
        {value}
        {note ? ` · ${note}` : ''}
      </span>
    </div>
  );
}

export const Colors: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-h4">Ramps (Figma node 5028:565054)</h2>
        {Object.entries(palette).map(([name, ramp]) => (
          <div key={name} className="grid grid-cols-3 gap-2 sm:grid-cols-9">
            {STEPS.map((step) => (
              <Swatch key={step} name={`${name}-${step}`} value={ramp[step]} />
            ))}
          </div>
        ))}
      </section>
      {(['light', 'dark'] as const).map((mode) => (
        <section key={mode} className="flex flex-col gap-3">
          <h2 className="text-h4">Semantic · {mode}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {BASE_TOKENS.map((token) => (
              <Swatch key={token} name={token} value={semantic[mode][token]} />
            ))}
          </div>
          <h3 className="text-h5">Status text on tint (≥ 4.5:1)</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {STATUS_HUES.map((hue) => {
              const fg = semantic[mode][`${hue}-strong`];
              const bg = semantic[mode][`${hue}-tint`];
              return (
                <div
                  key={hue}
                  className="rounded-md px-3 py-2 text-sm font-medium"
                  style={{ color: fg, background: bg }}
                >
                  {hue} · {contrastRatio(fg, bg).toFixed(2)}:1
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  ),
};

const TYPE = [
  ['text-display-1', 'Display 1 · 40/800'],
  ['text-display-2', 'Display 2 · 32/800'],
  ['text-h1', 'Heading 1 · 28/700'],
  ['text-h2', 'Heading 2 · 24/700'],
  ['text-h3', 'Heading 3 · 20/600'],
  ['text-h4', 'Heading 4 · 18/600'],
  ['text-h5', 'Heading 5 · 16/500'],
  ['text-h6', 'Heading 6 · 15/500'],
  ['text-sm', 'Body · 14/400'],
  ['text-sm font-medium', 'Navigation · 14/500'],
  ['text-xs', 'XS · 12/400'],
] as const;

export const Typography: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4">
      {TYPE.map(([className, label]) => (
        <div key={label} className="flex flex-col gap-1">
          <span className={className}>Global International School, Dehradun</span>
          <span className="text-muted-foreground text-xs">
            {label} · <code>{className}</code>
          </span>
        </div>
      ))}
    </div>
  ),
};

export const SpacingAndRadius: StoryObj = {
  name: 'Spacing & Radius',
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        {[1, 2, 3, 4, 6, 8, 12, 16].map((n) => (
          <div key={n} className="flex flex-col items-center gap-1">
            <div className="bg-primary" style={{ width: n * 4, height: n * 4 }} />
            <span className="text-muted-foreground text-xs">
              {n} · {n * 4}px
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {['rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl', 'rounded-full'].map((r) => (
          <div key={r} className="flex flex-col items-center gap-1">
            <div className={`border-border bg-card size-16 border ${r}`} />
            <span className="text-muted-foreground text-xs">{r}</span>
          </div>
        ))}
      </div>
    </div>
  ),
};
