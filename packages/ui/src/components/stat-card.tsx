import type { StatusHue } from '@classloom/design-tokens';
import { Card, CardContent, CardFooter } from '@classloom/ui/components/ui/card';
import type { Icon } from '@tabler/icons-react';
import type { ReactNode } from 'react';

import { IconTile } from './icon-tile';
import { StatusPill, type StatusTone } from './status-pill';

export interface StatCardProps {
  label: string;
  value: string;
  tone: StatusHue;
  icon: Icon;
  delta?: { label: string; tone: StatusTone };
  footer?: ReactNode;
}

/** Dashboard metric: icon tile, big value, label, optional delta pill and footer (Figma admin dashboard). */
export function StatCard({ label, value, tone, icon, delta, footer }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3">
        <IconTile tone={tone} icon={icon} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-h3 text-foreground truncate">{value}</span>
            {delta && <StatusPill tone={delta.tone}>{delta.label}</StatusPill>}
          </div>
          <span className="text-muted-foreground truncate text-sm">{label}</span>
        </div>
      </CardContent>
      {footer && <CardFooter className="text-muted-foreground text-sm">{footer}</CardFooter>}
    </Card>
  );
}
