import { ImageResponse } from 'next/og';

const VARIANTS = {
  '192': { size: 192, inset: 0 },
  '512': { size: 512, inset: 0 },
  // Maskable icons keep the mark inside the central 80% safe zone.
  maskable: { size: 512, inset: 0.1 },
} as const;

type Variant = keyof typeof VARIANTS;

export const dynamic = 'force-static';

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

/** PWA icons rendered at build time: a white "C" on the brand primary. */
export async function GET(_request: Request, { params }: RouteContext<'/icons/[variant]'>) {
  const { variant } = await params;
  const spec = VARIANTS[variant as Variant] ?? VARIANTS['512'];
  const { size, inset } = spec;
  const mark = size * (1 - inset * 2);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#3D5EE1',
        borderRadius: inset ? 0 : size * 0.22,
      }}
    >
      <div
        style={{
          display: 'flex',
          color: '#FFFFFF',
          fontSize: mark * 0.62,
          fontWeight: 800,
          lineHeight: 1,
        }}
      >
        C
      </div>
    </div>,
    { width: size, height: size },
  );
}
