import { navConfig, type NavItem } from '@/config/nav';

const flatten = (items: NavItem[]): NavItem[] =>
  items.flatMap((item) => [item, ...flatten(item.children ?? [])]);

const navItems = flatten(navConfig.flatMap((group) => group.items));

/**
 * The permission a top-level page (`students`, no slash) needs, taken from the navigation config
 * so the sidebar and the page share one source. `undefined` when the page is not in the navigation
 * or asks for none.
 */
export function permissionForSection(section: string): string | undefined {
  return navItems.find((item) => item.href === `/${section}`)?.permission;
}

/** Whether a member holding `permissions` may open the page; a page outside the navigation is closed. */
export function canOpenSection(section: string, permissions: readonly string[]): boolean {
  const item = navItems.find((entry) => entry.href === `/${section}`);
  if (!item) return false;
  return !item.permission || permissions.includes(item.permission);
}
