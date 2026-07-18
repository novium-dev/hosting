import Link from "next/link";
import {
  FolderKanban,
  Home,
  Network,
  Server,
  Users,
} from "lucide-react";
import { NoviumLogo } from "@/components/brand/novium-logo";
import { NavUserMenu } from "./nav-user-menu";
import { Button } from "../ui/button";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";

const adminLinks = [
  {
    title: "Users",
    href: "/admin/users",
    icon: Users,
    permission: ManagementPermission.USER_VIEW,
  },
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
    title: "Nodes",
    href: "/admin/nodes",
    icon: Network,
    permission: ManagementPermission.NODES_VIEW,
  },
] as const;

export function AdminNavbar({ permissions }: { permissions: number }) {
  const visibleLinks = adminLinks.filter((item) =>
    hasManagementPermission(permissions, item.permission),
  );

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-400 items-center gap-2 px-3 md:px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <NoviumLogo className="size-7" />
          <span className="text-sm font-semibold">Hephaestus Admin</span>
        </Link>

        <nav className="ml-2 flex min-w-0 items-center gap-1 overflow-x-auto">
          {visibleLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <item.icon className="size-4" />
              {item.title}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/">
              <Home className="mr-2 h-4 w-4" />
              Back
            </Link>
          </Button>

          <NavUserMenu />
        </div>
      </div>
    </header>
  );
}
