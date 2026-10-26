'use client';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@classloom/ui/components/ui/sidebar';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { navConfig } from '@/config/nav';
import { usePathname } from '@/i18n/navigation';
import { Link } from '@/i18n/navigation';
import { filterNav } from '@/lib/nav-filter';

import { CampusSwitcher } from './campus-switcher';

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export function AppSidebar({
  permissions,
  campus,
}: {
  permissions: string[];
  campus: { id: string; name: string };
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const groups = useMemo(() => filterNav(navConfig, new Set(permissions)), [permissions]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <CampusSwitcher campus={campus} />
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={t('shell.mainNavigation')}>
          {groups.map((group) => (
            <SidebarGroup key={group.key}>
              <SidebarGroupLabel>{t(`navGroups.${group.key}`)}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const label = t(`nav.${item.key}`);
                    const ItemIcon = item.icon;
                    return (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuButton
                          isActive={isActive(pathname, item.href)}
                          tooltip={label}
                          render={
                            <Link
                              href={item.href}
                              onClick={() => {
                                if (isMobile) setOpenMobile(false);
                              }}
                            />
                          }
                        >
                          <ItemIcon />
                          <span>{label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
