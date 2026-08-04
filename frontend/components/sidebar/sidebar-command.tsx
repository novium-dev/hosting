"use client";

import {
  BellIcon,
  DatabaseIcon,
  HomeIcon,
  KeyRoundIcon,
  LogOutIcon,
  LucideIcon,
  MoonIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  UserIcon,
  Users2Icon,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { useSettingsDialog } from "@/hooks/use-settings-dialog";
import { useParams, useRouter } from "@/lib/navigation";
import { useEffect, useState } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { appConfig } from "@/constants/config";
import { useOrganization } from "@/hooks/use-organization";
import { authClient } from "@/lib/auth-client";
import { ServerPermission, hasServerPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type CommandMenuItem = {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  href?: string;
  action?: () => void;
  keywords?: string[];
  disabled?: boolean;
};

type CommandMenuSection = {
  heading: string;
  items: CommandMenuItem[];
};

export function SidebarCommand({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const { data: session } = authClient.useSession();
  const { data: organization } = useOrganization(slug);
  const { theme, setTheme } = useTheme();
  const { open: openSettings } = useSettingsDialog();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Handle keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const sections: CommandMenuSection[] = [
    {
      heading: "Navigation",
      items: [
        {
          icon: HomeIcon,
          label: "Home",
          shortcut: "H",
          href: "/",
          keywords: ["dashboard", "main"],
        },
        {
          icon: SettingsIcon,
          label: "Settings",
          href: `/${slug}/settings`,
          keywords: ["preferences", "config", "options"],
        },
        {
          icon: Users2Icon,
          label: "Members",
          href: `/${slug}/members`,
          keywords: ["users", "collaborators", "invite"],
        },
        ...(hasServerPermission(
          organization?.permissions ?? 0,
          ServerPermission.DATABASE_VIEW,
        )
          ? [
              {
                icon: DatabaseIcon,
                label: "Databases",
                href: `/${slug}/databases`,
                keywords: [
                  "postgres",
                  "mariadb",
                  "mysql",
                  "mongodb",
                  "redis",
                  "sql",
                ],
              },
            ]
          : []),
        {
          icon: KeyRoundIcon,
          label: "API keys",
          href: `/${slug}/api-keys`,
          keywords: ["token", "api", "automation", "integration"],
        },
      ],
    },
    {
      heading: "Account",
      items: [
        {
          icon: UserIcon,
          label: "Profile",
          action: () => openSettings("profile"),
          keywords: ["personal", "details", "account", "settings"],
        },
        {
          icon: KeyRoundIcon,
          label: "Daemon Auth",
          action: () => openSettings("daemon"),
          keywords: ["ssh", "sftp", "password", "keys"],
        },
        {
          icon: BellIcon,
          label: "Notifications",
          href: "/settings/notifications",
          disabled: true,
          keywords: ["alerts", "messages"],
        },
      ],
    },
    {
      heading: "Theme",
      items: [
        {
          icon: theme === "dark" ? SunIcon : MoonIcon,
          label: theme === "dark" ? "Light Mode" : "Dark Mode",
          shortcut: "T",
          action: () => setTheme(theme === "dark" ? "light" : "dark"),
          keywords: ["dark", "light", "appearance", "mode"],
        },
      ],
    },
    {
      heading: "Session",
      items: [
        {
          icon: LogOutIcon,
          label: "Sign Out",
          shortcut: "⇧L",
          action: () =>
            authClient.signOut({
              fetchOptions: {
                onSuccess: () => router.push(appConfig.authRoutes.signin),
              },
            }),
          keywords: ["logout", "exit"],
        },
      ],
    },
  ];

  // Filter out commands that require user session if not logged in
  const filteredSections = session
    ? sections
    : sections.filter(
        (section) =>
          section.heading !== "Account" && section.heading !== "Session",
      );

  function runCommand(command: CommandMenuItem) {
    setOpen(false);

    requestAnimationFrame(() => {
      if (command.href) {
        router.push(command.href);
      } else if (command.action) {
        command.action();
      }
    });
  }

  return (
    <div className={cn("relative w-full", className)} {...props}>
      <div className="relative">
        <SearchIcon
          className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
        <div
          onClick={() => setOpen(true)}
          className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-2 py-2 text-sm flex items-center cursor-pointer"
        >
          <span className="text-muted-foreground">Search...</span>
          <div className="ml-auto flex items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">
            <span className="text-xs">⌘</span>K
          </div>
        </div>
      </div>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Type a command or search..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {filteredSections.map((section) => (
            <CommandGroup key={section.heading} heading={section.heading}>
              {section.items
                .filter(
                  (item) =>
                    !query ||
                    item.label.toLowerCase().includes(query.toLowerCase()) ||
                    item.keywords?.some((keyword) =>
                      keyword.toLowerCase().includes(query.toLowerCase()),
                    ),
                )
                .map((item) => (
                  <CommandItem
                    key={item.label}
                    onSelect={() => (item.disabled ? null : runCommand(item))}
                    className={cn(
                      "cursor-pointer",
                      item.disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <item.icon className="mr-2 h-4 w-4" />
                    <span>{item.label}</span>
                    {item.shortcut && (
                      <CommandShortcut>{item.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </div>
  );
}
