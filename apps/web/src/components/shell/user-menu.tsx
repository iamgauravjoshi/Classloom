'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@classloom/ui/components/ui/avatar';
import { Button } from '@classloom/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@classloom/ui/components/ui/dropdown-menu';
import { IconLogout, IconSettings, IconUser } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';

import type { Role } from '@/lib/mock-session';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

export function UserMenu({
  user,
  role,
}: {
  user: { name: string; avatarUrl?: string };
  role: Role;
}) {
  const t = useTranslations();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" className="size-11 md:size-8" />}
      >
        <Avatar className="size-8">
          {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
          <AvatarFallback>{initials(user.name)}</AvatarFallback>
        </Avatar>
        {/* Name is "<initials> Account menu": axe requires visible text (the initials) in the name. */}
        <span className="sr-only">{t('shell.accountMenu')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col">
            <span className="text-foreground truncate">{user.name}</span>
            <span className="truncate text-xs font-normal">{t(`roles.${role}`)}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled>
            <IconUser />
            {t('shell.profile')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <IconSettings />
            {t('shell.settings')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled>
            <IconLogout />
            {t('shell.signOut')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
