import type { NavGroup, NavItem } from '@/config/nav';

const visible = (item: NavItem, permissions: ReadonlySet<string>) =>
  !item.permission || permissions.has(item.permission);

function filterItems(items: NavItem[], permissions: ReadonlySet<string>): NavItem[] {
  return items
    .filter((item) => visible(item, permissions))
    .map((item) =>
      item.children ? { ...item, children: filterItems(item.children, permissions) } : item,
    );
}

/** Keeps only the nav items the user may see, dropping groups that end up empty. */
export function filterNav(groups: NavGroup[], permissions: ReadonlySet<string>): NavGroup[] {
  return groups
    .map((group) => ({ ...group, items: filterItems(group.items, permissions) }))
    .filter((group) => group.items.length > 0);
}
