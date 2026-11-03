'use client';

import { Button } from '@classloom/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@classloom/ui/components/ui/dropdown-menu';
import { IconDotsVertical } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';

import type { Row, RowAction } from './members-model';

const MENU_KEYS = {
  roles: 'menu.changeRoles',
  deactivate: 'menu.deactivate',
  reactivate: 'menu.reactivate',
  reset: 'menu.resetTwoFactor',
  resend: 'menu.resend',
  revoke: 'menu.revoke',
} as const satisfies Record<RowAction, string>;

interface MemberRowMenuProps {
  row: Row;
  actions: RowAction[];
  /** The button that opened the menu is where focus returns when the action's dialog closes. */
  onAction: (action: RowAction, row: Row, trigger: HTMLElement | null) => void;
}

/** The "⋮" menu at the end of a row (a 44 px target on touch). */
export function MemberRowMenu({ row, actions, onAction }: MemberRowMenuProps) {
  const t = useTranslations('iam');
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            ref={triggerRef}
            variant="ghost"
            className="size-10 pointer-coarse:size-11"
            aria-label={t('members.actionsFor', { name: row.name })}
          />
        }
      >
        <IconDotsVertical aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action}
            variant={action === 'deactivate' || action === 'revoke' ? 'destructive' : 'default'}
            className="min-h-9 pointer-coarse:min-h-11"
            onClick={() => onAction(action, row, triggerRef.current)}
          >
            {t(MENU_KEYS[action])}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
