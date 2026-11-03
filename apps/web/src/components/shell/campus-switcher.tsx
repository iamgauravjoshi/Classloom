'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@classloom/ui/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@classloom/ui/components/ui/sidebar';
import { IconPlus, IconSchool, IconSelector } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';

/**
 * Campus picker at the top of the sidebar (PreSkool's school switcher). One campus until Phase 1.
 * It shows the school's logo when there is one, else the plain mark.
 */
export function CampusSwitcher({
  campus,
  logoUrl,
}: {
  campus: { id: string; name: string };
  logoUrl: string | null;
}) {
  const t = useTranslations('shell');
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
            {logoUrl ? (
              // Decorative: the button is named by the campus. A versioned PNG from the API.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                width={32}
                height={32}
                className="size-8 shrink-0 rounded-md bg-white object-contain p-0.5"
              />
            ) : (
              <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
                <IconSchool />
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col text-left">
              <span className="text-muted-foreground truncate text-xs">{t('campus')}</span>
              <span className="truncate font-medium">{campus.name}</span>
            </span>
            <IconSelector className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56" align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('switchCampus')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={campus.id}>
                <DropdownMenuRadioItem value={campus.id}>{campus.name}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem disabled>
                <IconPlus />
                {t('addCampus')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
