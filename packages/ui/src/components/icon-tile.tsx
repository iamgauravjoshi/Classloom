import type { StatusHue } from '@classloom/design-tokens';
import { cn } from '@classloom/ui/lib/utils';
import type { Icon } from '@tabler/icons-react';

const tileClasses: Record<StatusHue, string> = {
  primary: 'bg-primary-tint text-primary-strong',
  secondary: 'bg-secondary-tint text-secondary-strong',
  success: 'bg-success-tint text-success-strong',
  warning: 'bg-warning-tint text-warning-strong',
  danger: 'bg-danger-tint text-danger-strong',
  info: 'bg-info-tint text-info-strong',
  sky: 'bg-sky-tint text-sky-strong',
  violet: 'bg-violet-tint text-violet-strong',
  pink: 'bg-pink-tint text-pink-strong',
  orange: 'bg-orange-tint text-orange-strong',
  green: 'bg-green-tint text-green-strong',
  red: 'bg-red-tint text-red-strong',
};

export interface IconTileProps {
  tone: StatusHue;
  icon: Icon;
  className?: string;
}

/** Rounded, tinted square holding an icon (stat cards, quick links). */
export function IconTile({ tone, icon: IconComponent, className }: IconTileProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-12 shrink-0 items-center justify-center rounded-lg',
        tileClasses[tone],
        className,
      )}
    >
      <IconComponent size={24} stroke={1.75} />
    </span>
  );
}
