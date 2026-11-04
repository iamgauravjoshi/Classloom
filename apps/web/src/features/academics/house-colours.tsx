import type { HouseColour } from '@classloom/contracts';
import { cn } from '@classloom/ui/lib/utils';
import { useTranslations } from 'next-intl';

/**
 * Each house colour as a theme tint and strong pair. The strong colour passes AA as text on the
 * tint in light and dark, so the swatch dot (drawn in the text colour) and the colour's name both
 * read; the name is always shown, so the colour never carries meaning alone.
 */
export const HOUSE_COLOUR_CLASS: Record<HouseColour, string> = {
  RED: 'bg-red-tint text-red-strong',
  BLUE: 'bg-info-tint text-info-strong',
  GREEN: 'bg-green-tint text-green-strong',
  YELLOW: 'bg-warning-tint text-warning-strong',
  ORANGE: 'bg-orange-tint text-orange-strong',
  PURPLE: 'bg-violet-tint text-violet-strong',
  PINK: 'bg-pink-tint text-pink-strong',
  TEAL: 'bg-secondary-tint text-secondary-strong',
  BROWN: 'bg-house-brown-tint text-house-brown-strong',
  GREY: 'bg-muted text-muted-foreground',
};

/** A filled dot in the colour, beside its name. */
export function HouseSwatch({ colour, className }: { colour: HouseColour; className?: string }) {
  const t = useTranslations('academics.houses.colours');
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-2 rounded-full px-3 text-sm font-medium',
        HOUSE_COLOUR_CLASS[colour],
        className,
      )}
    >
      <span aria-hidden="true" className="size-3 shrink-0 rounded-full bg-current" />
      {t(colour)}
    </span>
  );
}
