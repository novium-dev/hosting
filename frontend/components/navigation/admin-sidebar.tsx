import Link from "@/components/link";
import {
  Boxes,
  Database,
  FolderKanban,
  Globe,
  Globe2,
  Home,
  KeyRound,
  Network,
  Server,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { NoviumLogo } from "@/components/brand/novium-logo";
import { NavUserMenu } from "./nav-user-menu";
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
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { usePathname } from "@/lib/navigation";

export function AdminSidebar({ permissions }: { permissions: number }) {
  const pathname = usePathname();
  const { t } = useTranslation();

  const adminGroups = [
    {
      label: t("navigation:adminSidebar.groups.access"),
      items: [
        {
          title: t("common:nav.users"),
          href: "/admin/users",
          icon: Users,
          permission: ManagementPermission.USER_VIEW,
        },
        {
          title: t("common:nav.apiKeys"),
          href: "/admin/api-keys",
          icon: KeyRound,
          permission: ManagementPermission.API_KEYS_VIEW,
        },
      ],
    },
    {
      label: t("navigation:adminSidebar.groups.workloads"),
      items: [
        {
          title: t("common:nav.projects"),
          href: "/admin/projects",
          icon: FolderKanban,
          permission: ManagementPermission.SERVER_MANAGE,
        },
        {
          title: t("common:nav.servers"),
          href: "/admin/servers",
          icon: Server,
          permission: ManagementPermission.SERVER_MANAGE,
        },
        {
          title: t("common:nav.templates"),
          href: "/admin/templates",
          icon: Boxes,
          permission: ManagementPermission.SERVER_MANAGE,
        },
      ],
    },
    {
      label: t("navigation:adminSidebar.groups.infrastructure"),
      items: [
        {
          title: t("common:nav.regions"),
          href: "/admin/regions",
          icon: Globe2,
          permission: ManagementPermission.NODES_VIEW,
        },
        {
          title: t("common:nav.nodes"),
          href: "/admin/nodes",
          icon: Network,
          permission: ManagementPermission.NODES_VIEW,
        },
        {
          title: t("navigation:adminSidebar.items.domains"),
          href: "/admin/domains",
          icon: Globe,
          permission: ManagementPermission.DOMAINS_VIEW,
        },
        {
          title: t("common:nav.databases"),
          href: "/admin/databases",
          icon: Database,
          permission: ManagementPermission.DATABASE_HOSTS_VIEW,
        },
      ],
    },
  ];

  const visibleGroups = adminGroups
    .map((group) => ({
      label: group.label,
      items: group.items.filter((item) =>
        hasManagementPermission(permissions, item.permission),
      ),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/admin/users">
                <NoviumLogo className="size-7 shrink-0" />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Hephaestus</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t("navigation:adminSidebar.subtitle")}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      isActive={
                        pathname === item.href ||
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
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip={t("navigation:adminSidebar.backToApp")}
            >
              <Link href="/">
                <Home />
                <span>{t("navigation:adminSidebar.backToApp")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
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
