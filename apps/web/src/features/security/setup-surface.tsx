'use client';

import { DialogDescription, DialogFooter, DialogTitle } from '@classloom/ui/components/ui/dialog';
import { cn } from '@classloom/ui/lib/utils';
import type { ReactNode } from 'react';

/**
 * Where a two-step flow is drawn: inside an open dialog (its title, description and footer are the
 * dialog's own parts) or as a section of a page (plain heading, text and button row).
 */
export type Surface = 'dialog' | 'page';

export function SurfaceTitle({ surface, children }: { surface: Surface; children: ReactNode }) {
  return surface === 'dialog' ? (
    <DialogTitle className="text-h6">{children}</DialogTitle>
  ) : (
    <h2 className="text-h6 leading-none font-medium">{children}</h2>
  );
}

export function SurfaceDescription({
  surface,
  children,
}: {
  surface: Surface;
  children: ReactNode;
}) {
  return surface === 'dialog' ? (
    <DialogDescription>{children}</DialogDescription>
  ) : (
    <p className="text-muted-foreground text-sm">{children}</p>
  );
}

export function SurfaceFooter({ surface, children }: { surface: Surface; children: ReactNode }) {
  return surface === 'dialog' ? (
    <DialogFooter>{children}</DialogFooter>
  ) : (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>
  );
}

/** Header block: the dialog keeps room for its close button. */
export function surfaceHeaderClass(surface: Surface): string {
  return cn('flex flex-col gap-2', surface === 'dialog' && 'pr-8');
}
