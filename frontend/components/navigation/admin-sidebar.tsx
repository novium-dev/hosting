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

const adminGroups = [
  {
    label: "Access",
    items: [
      {
        title: "Users",
        href: "/admin/users",
        icon: Users,
        permission: ManagementPermission.USER_VIEW,
      },
      {
        title: "API keys",
        href: "/admin/api-keys",
        icon: KeyRound,
        permission: ManagementPermission.API_KEYS_VIEW,
      },
    ],
  },
  {
    label: "Workloads",
    items: [
      {
        title: "Projects",
        href: "/admin/projects",
        icon: FolderKanban,
        permission: ManagementPermission.SERVER_MANAGE,
      },
      {
        title: "Servers",
        href: "/admin/servers",
        icon: Server,
        permission: ManagementPermission.SERVER_MANAGE,
      },
      {
        title: "Templates",
        href: "/admin/templates",
        icon: Boxes,
        permission: ManagementPermission.SERVER_MANAGE,
      },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      {
        title: "Regions",
        href: "/admin/regions",
        icon: Globe2,
        permission: ManagementPermission.NODES_VIEW,
      },
      {
        title: "Nodes",
        href: "/admin/nodes",
        icon: Network,
        permission: ManagementPermission.NODES_VIEW,
      },
      {
        title: "Domains",
        href: "/admin/domains",
        icon: Globe,
        permission: ManagementPermission.DOMAINS_VIEW,
      },
      {
        title: "Databases",
        href: "/admin/databases",
        icon: Database,
        permission: ManagementPermission.DATABASE_HOSTS_VIEW,
      },
    ],
  },
] as const;

export function AdminSidebar({ permissions }: { permissions: number }) {
  const pathname = usePathname();

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
                    Administration
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
            <SidebarMenuButton asChild tooltip="Back to app">
              <Link href="/">
                <Home />
                <span>Back to app</span>
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
