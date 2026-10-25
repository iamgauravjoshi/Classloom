import { Badge } from '@classloom/ui/components/ui/badge';
import { cn } from '@classloom/ui/lib/utils';
import type { ReactNode } from 'react';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const toneClasses: Record<StatusTone, { pill: string; dot: string }> = {
  success: { pill: 'bg-success-tint text-success-strong', dot: 'bg-success-strong' },
  warning: { pill: 'bg-warning-tint text-warning-strong', dot: 'bg-warning-strong' },
  danger: { pill: 'bg-danger-tint text-danger-strong', dot: 'bg-danger-strong' },
  info: { pill: 'bg-info-tint text-info-strong', dot: 'bg-info-strong' },
  neutral: { pill: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
};

export interface StatusPillProps {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}

/** Tinted status label with a dot, as in the Figma student cards (Active / Inactive). */
export function StatusPill({ tone, children, className }: StatusPillProps) {
  const classes = toneClasses[tone];
  return (
    <Badge
      variant="secondary"
      className={cn('gap-1.5 border-transparent', classes.pill, className)}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', classes.dot)} />
      {children}
    </Badge>
  );
}
