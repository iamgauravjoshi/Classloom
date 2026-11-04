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
import { IconBuildingCommunity, IconSchool, IconSelector } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

import { useSelectedCampus } from './selection-provider';

/**
 * Campus picker at the top of the sidebar (spec §7): the active campuses, primary first. The
 * choice is remembered in `cl_campus` and falls back to the primary campus. People who manage
 * settings also get "Manage campuses". It shows the school's logo when there is one, else the
 * plain mark.
 */
export function CampusSwitcher({
  logoUrl,
  canManage,
  onNavigate,
}: {
  logoUrl: string | null;
  canManage: boolean;
  /** Called when a link in the menu is followed (closes the phone sidebar). */
  onNavigate?: () => void;
}) {
  const t = useTranslations('shell');
  const { campus, campuses, isPending, select } = useSelectedCampus();
  const name = campus?.name ?? (isPending ? t('campusLoading') : t('campusNone'));

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
              <span className="truncate font-medium">{name}</span>
            </span>
            <IconSelector className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56" align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('switchCampus')}</DropdownMenuLabel>
              {campuses.length > 0 ? (
                <DropdownMenuRadioGroup
                  value={campus?.id ?? ''}
                  onValueChange={(id: string) => select(id)}
                >
                  {campuses.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.id}
                      value={option.id}
                      className="pointer-coarse:min-h-11"
                    >
                      <span className="min-w-0 truncate">
                        {option.isPrimary ? t('campusPrimary', { name: option.name }) : option.name}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              ) : (
                <p className="text-muted-foreground px-2 py-1.5 text-sm" role="status">
                  {isPending ? t('campusLoading') : t('campusNone')}
                </p>
              )}
            </DropdownMenuGroup>
            {canManage ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    className="pointer-coarse:min-h-11"
                    render={<Link href="/settings/campuses" onClick={onNavigate} />}
                  >
                    <IconBuildingCommunity />
                    {t('manageCampuses')}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
