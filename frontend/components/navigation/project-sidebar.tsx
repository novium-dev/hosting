import Link from "@/components/link";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import {
  Database,
  KeyRound,
  Server,
  Settings,
  Shield,
  Users,
} from "lucide-react";

import { ProjectSwitcher } from "@/components/sidebar/project-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useProject } from "@/hooks/use-project";
import { listProjectInstances, serverInfo } from "@/lib/api";
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
  const { data: infoResponse } = useSWR(
    server ? ["server-info", server] : null,
    () => serverInfo({ path: { server_id: server } }),
  );

  const { data: instances } = useSWR(
    instance && project ? ["project-instances", project.id] : null,
    async () => {
      const response = await listProjectInstances({
        path: { project_id: project?.id ?? "" },
      });
      if (response.error) {
        throw new Error(response.error.error?.msg ?? "Failed to load instances");
      }
      return response.data ?? [];
    },
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

  const visibleProjectItems = projectItems.filter(
    (item) =>
      item.permission === undefined ||
      hasServerPermission(project?.permissions ?? 0, item.permission),
  );

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

  const canAccessAdmin = hasAnyManagementPermission(
    session?.user.permissions ?? 0,
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <ProjectSwitcher />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            {t("navigation:projectSidebar.groups.project")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleProjectItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.title}
                    isActive={
                      item.exact
                        ? pathname === item.href
                        : pathname === item.href ||
                          pathname.startsWith(`${item.href}/`)
                    }
                  >
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {serverSections.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="truncate">
              {serverData?.name ??
                t("navigation:projectSidebar.groups.server")}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {serverSections.map((entry) => {
                  const title = t(`servers:page.sections.${entry.key}.label`);

                  return (
                    <SidebarMenuItem key={entry.key}>
                      <SidebarMenuButton
                        asChild
                        tooltip={title}
                        isActive={activeServerSection === entry.key}
                      >
                        <Link href={serverSectionHref(slug, server, entry.key)}>
                          <entry.icon />
                          <span>{title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {instance && (
          <SidebarGroup>
            <SidebarGroupLabel className="truncate">
              {instanceData?.display ??
                t("navigation:projectSidebar.groups.instance")}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {INSTANCE_SECTIONS.map((entry) => {
                  const title = t(entry.titleKey);

                  return (
                    <SidebarMenuItem key={entry.key}>
                      <SidebarMenuButton
                        asChild
                        tooltip={title}
                        isActive={activeInstanceSection === entry.key}
                      >
                        <Link
                          href={instanceSectionHref(slug, instance, entry.key)}
                        >
                          <entry.icon />
                          <span>{title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        {canAccessAdmin && (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip={t("common:nav.admin")}>
                <Link href="/admin">
                  <Shield />
                  <span>{t("common:nav.admin")}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        <SidebarSeparator />
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
