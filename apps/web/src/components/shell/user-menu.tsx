'use client';

import { useSignOut } from '@classloom/api-client';
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
import { toast } from '@classloom/ui/components/ui/toast';
import { IconLogout, IconUser } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { clearSentCode } from '@/features/auth/sent-code';
import { Link, useRouter } from '@/i18n/navigation';
import type { Role } from '@/lib/session';
import { leavesAfterSignOut } from '@/lib/sign-out';

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
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOut = useSignOut({
    mutation: {
      // Leave on success or a 401 (already ended). A server or network error may leave the
      // session live, so stay and say so.
      onSettled: (_data, error) => {
        if (leavesAfterSignOut(error)) {
          queryClient.clear();
          clearSentCode();
          router.replace('/sign-in');
        } else {
          toast.add({ title: t('shell.signOutFailed'), type: 'error' });
        }
      },
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" className="size-8 pointer-coarse:size-11" />}
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
          <DropdownMenuItem render={<Link href="/account" />}>
            <IconUser />
            {t('shell.myAccount')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={signOut.isPending} onClick={() => signOut.mutate()}>
            <IconLogout />
            {t('shell.signOut')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
