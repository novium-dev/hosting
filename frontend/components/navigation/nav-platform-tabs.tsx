"use client";

import { cn } from "@/lib/utils";
import Link from "@/components/link";
import { useTranslation } from "react-i18next";
import { useOrganization } from "@/hooks/use-organization";
import { useParams, usePathname } from "@/lib/navigation";
import { ServerPermission, hasServerPermission } from "@/lib/permissions";

export function NavPlatformTabs() {
  const params = useParams<{ slug: string }>();
  const pathname = usePathname();
  const slug = params.slug;
  const { data: organization } = useOrganization(slug);
  const { t } = useTranslation();

  const items = [
    {
      id: "dashboard",
      title: t("navigation:platformTabs.dashboard"),
      path: "",
    },
    {
      id: "members",
      title: t("navigation:platformTabs.members"),
      path: "/members",
    },
    {
      id: "databases",
      title: t("navigation:platformTabs.databases"),
      path: "/databases",
      permission: ServerPermission.DATABASE_VIEW,
    },
    {
      id: "api-keys",
      title: t("navigation:platformTabs.apiKeys"),
      path: "/api-keys",
    },
    {
      id: "settings",
      title: t("navigation:platformTabs.settings"),
      path: "/settings",
    },
  ] as const;

  const visible = items.filter(
    (item) =>
      !("permission" in item) ||
      hasServerPermission(organization?.permissions ?? 0, item.permission),
  );

  return (
    <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {visible.map((item) => {
        const href = `/${slug}${item.path}`;
        const isActive = item.path
          ? pathname.startsWith(href)
          : pathname === href;

        return (
          <Link
            key={item.id}
            href={href}
            className={cn(
              "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
              isActive && "bg-muted text-foreground",
            )}
          >
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}
