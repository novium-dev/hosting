"use client";

import { cn } from "@/lib/utils";
import Link from "@/components/link";
import { useParams, usePathname } from "@/lib/navigation";

const items = [
  {
    id: "dashboard",
    title: "Dashboard",
    path: "",
  },
  {
    id: "members",
    title: "Members",
    path: "/members",
  },
  {
    id: "settings",
    title: "Settings",
    path: "/settings",
  },
] as const;

export function NavPlatformTabs() {
  const params = useParams<{ slug: string }>();
  const pathname = usePathname();
  const slug = params.slug;

  return (
    <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {items.map((item) => {
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
