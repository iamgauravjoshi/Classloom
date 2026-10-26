import { IconBook } from '@tabler/icons-react';

import type { NavGroup } from '@/config/nav';

import { filterNav } from './nav-filter';

const X = IconBook;

const groups: NavGroup[] = [
  {
    key: 'people',
    items: [
      { key: 'students', href: '/students', icon: X, permission: 'students.read' },
      {
        key: 'fees',
        href: '/fees',
        icon: X,
        permission: 'fees.read',
        children: [{ key: 'collect', href: '/fees/collect', icon: X, permission: 'fees.collect' }],
      },
      { key: 'help', href: '/help', icon: X },
    ],
  },
  { key: 'empty', items: [{ key: 'hidden', href: '/h', icon: X, permission: 'nope' }] },
];

describe('filterNav', () => {
  it('keeps items the user may see and items without a permission', () => {
    const out = filterNav(groups, new Set(['students.read', 'fees.read']));
    expect(out.map((g) => g.key)).toEqual(['people']);
    expect(out[0]?.items.map((i) => i.key)).toEqual(['students', 'fees', 'help']);
  });

  it('removes children the user lacks permission for', () => {
    const out = filterNav(groups, new Set(['students.read', 'fees.read']));
    expect(out[0]?.items[1]?.children).toEqual([]);
  });

  it('drops groups left empty', () => {
    const out = filterNav(groups, new Set());
    expect(out.map((g) => g.key)).toEqual(['people']);
    expect(out[0]?.items.map((i) => i.key)).toEqual(['help']);
  });

  it('returns nothing when no item is visible', () => {
    const locked: NavGroup[] = [
      { key: 'g', items: [{ key: 'a', href: '/a', icon: X, permission: 'p' }] },
    ];
    expect(filterNav(locked, new Set())).toEqual([]);
  });

  it('does not mutate the input', () => {
    const snapshot = JSON.stringify(groups.map((g) => g.items.map((i) => i.children?.length)));
    filterNav(groups, new Set());
    expect(JSON.stringify(groups.map((g) => g.items.map((i) => i.children?.length)))).toBe(
      snapshot,
    );
  });
});
