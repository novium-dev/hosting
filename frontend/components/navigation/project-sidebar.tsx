import Link from "@/components/link";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Database,
  Globe,
  KeyRound,
  Server,
  Settings,
  Shield,
  Users,
} from "lucide-react";

import { ProjectSwitcher } from "@/components/sidebar/project-switcher";
import { SidebarCommand } from "@/components/sidebar/sidebar-command";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useProject } from "@/hooks/use-project";
import { useProjectInstances, useServerInfo } from "@/hooks/use-shared-queries";
import { authClient } from "@/lib/auth-client";
import { useProjectRoute } from "@/lib/project-route";
import {
  hasAnyManagementPermission,
  hasManagementPermission,
  hasServerPermission,
  ManagementPermission,
  mergePermissions,
  ServerPermission,
} from "@/lib/permissions";
import {
  getActiveInstanceSection,
  INSTANCE_SECTIONS,
  instanceSectionHref,
} from "@/lib/instance-sections";
import {
  getVisibleServerSections,
  hasBackupSlots,
  serverSectionHref,
} from "@/lib/server-sections";
import { NavUserMenu } from "./nav-user-menu";

export function ProjectSidebar() {
  const { t } = useTranslation();
  const { pathname, slug, server, serverSection, instance, instanceSection } =
    useProjectRoute();
  const { data: session } = authClient.useSession();
  const { data: project } = useProject(slug);
  const { data: infoResponse } = useServerInfo(server);

  const { data: instances } = useProjectInstances(
    instance ? project?.id : null,
  );

  const serverData =
    infoResponse && !infoResponse.error ? infoResponse.data : null;
  const instanceData = instances?.find(
    (candidate) => candidate.id === instance,
  );
  const effectivePermissions = mergePermissions(
    session?.user.permissions ?? 0,
    project?.permissions ?? 0,
  );

  const projectItems = [
    {
      title: t("common:nav.servers"),
      href: `/${slug}`,
      icon: Server,
      exact: true,
    },
    {
      title: t("common:nav.members"),
      href: `/${slug}/members`,
      icon: Users,
    },
    {
      title: t("common:nav.databases"),
      href: `/${slug}/databases`,
      icon: Database,
      permission: ServerPermission.DATABASE_VIEW,
    },
    {
      title: t("common:nav.domains"),
      href: `/${slug}/domains`,
      icon: Globe,
    },
    {
      title: t("common:nav.apiKeys"),
      href: `/${slug}/api-keys`,
      icon: KeyRound,
    },
    {
      title: t("common:nav.settings"),
      href: `/${slug}/settings`,
      icon: Settings,
    },
  ];

  const visibleProjectItems = projectItems
    .filter(
      (item) =>
        item.permission === undefined ||
        hasServerPermission(project?.permissions ?? 0, item.permission),
    )
    .map((item) => ({
      title: item.title,
      href: item.href,
      icon: item.icon,
      isActive: item.exact
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`),
    }));

  const serverSections = server
    ? getVisibleServerSections(
        effectivePermissions,
        serverData?.features ?? [],
        hasBackupSlots(
          serverData?.limits.backup,
          hasManagementPermission(
            effectivePermissions,
            ManagementPermission.LIMITS_BYPASS,
          ),
        ),
      )
    : [];

  const activeServerSection =
    serverSection === "edit" ? "files" : serverSection;

  const activeInstanceSection = getActiveInstanceSection(instanceSection);

  const serverItems = serverSections.map((entry) => ({
    title: t(`servers:page.sections.${entry.key}.label`),
    href: serverSectionHref(slug, server, entry.key),
    icon: entry.icon,
    isActive: activeServerSection === entry.key,
  }));

  const instanceItems = INSTANCE_SECTIONS.map((entry) => ({
    title: t(entry.titleKey),
    href: instanceSectionHref(slug, instance, entry.key),
    icon: entry.icon,
    isActive: activeInstanceSection === entry.key,
  }));

  const detail = server
    ? {
        title: serverData?.name ?? t("navigation:projectSidebar.groups.server"),
        backHref: `/${slug}`,
      }
    : instance
      ? {
          title:
            instanceData?.display ??
            t("navigation:projectSidebar.groups.instance"),
          backHref: `/${slug}/databases`,
        }
      : null;

  const navItems = server
    ? serverItems
    : instance
      ? instanceItems
      : visibleProjectItems;

  const canAccessAdmin = hasAnyManagementPermission(
    session?.user.permissions ?? 0,
  );

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <ProjectSwitcher />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarCommand />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {detail && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip={t("navigation:projectSidebar.back")}
                    aria-label={t("navigation:projectSidebar.back")}
                    render={<Link href={detail.backHref} />}
                  >
                    <ArrowLeft />
                    <span className="flex-1 pr-6 text-center font-medium">
                      {detail.title}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={item.isActive}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {canAccessAdmin && (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t("common:nav.admin")}
                render={<Link href="/admin" />}
              >
                <Shield />
                <span>{t("common:nav.admin")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <NavUserMenu variant="sidebar" />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
