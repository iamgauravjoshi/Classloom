import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@classloom/ui/components/ui/breadcrumb';
import { Fragment, type ReactElement, type ReactNode } from 'react';

export interface Crumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  breadcrumbs: Crumb[];
  actions?: ReactNode;
  /** Renders breadcrumb links with the app's router link (e.g. `href => <Link href={href} />`). */
  renderLink?: (href: string) => ReactElement;
}

/** Page title with breadcrumbs on the left and actions on the right; stacks on small screens. */
export function PageHeader({ title, breadcrumbs, actions, renderLink }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-h4 text-foreground truncate">{title}</h1>
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((crumb, index) => (
              <Fragment key={`${crumb.label}-${index}`}>
                {index > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem className="min-w-0">
                  {crumb.href ? (
                    <BreadcrumbLink href={crumb.href} render={renderLink?.(crumb.href)}>
                      {crumb.label}
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
