import type { ReactNode } from 'react';

export interface AuthCardProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Brand mark shown above the card; supplied by the app (this package has no brand assets). */
  logo?: ReactNode;
  /** Copyright line shown below the card. */
  copyright?: string;
}

/** The Figma auth card: logo above, max 440 px, soft primary glow behind, copyright below. */
export function AuthCard({ title, description, children, footer, logo, copyright }: AuthCardProps) {
  return (
    <div className="relative isolate flex min-h-dvh w-full flex-col items-center justify-center gap-6 overflow-hidden px-4 py-10">
      <div
        aria-hidden="true"
        className="bg-primary/15 pointer-events-none absolute top-1/2 left-1/2 -z-10 size-[28rem] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
      />
      {logo && <div className="text-foreground flex items-center">{logo}</div>}
      <div className="bg-card text-card-foreground ring-foreground/10 flex w-full max-w-[440px] flex-col gap-6 rounded-xl p-6 shadow-sm ring-1 sm:p-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-h4 text-foreground">{title}</h1>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
        {children}
        {footer && <div className="text-muted-foreground text-center text-sm">{footer}</div>}
      </div>
      {copyright && <p className="text-muted-foreground text-sm">{copyright}</p>}
    </div>
  );
}
