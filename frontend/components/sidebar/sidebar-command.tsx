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
import { useTranslation } from "react-i18next";

import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { appConfig } from "@/constants/config";
import { useProject } from "@/hooks/use-project";
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
  const { data: project } = useProject(slug);
  const { theme, setTheme } = useTheme();
  const { open: openSettings } = useSettingsDialog();
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

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
      heading: t("navigation:command.sections.navigation"),
      items: [
        {
          icon: HomeIcon,
          label: t("navigation:command.items.home"),
          shortcut: "H",
          href: "/",
          keywords: ["dashboard", "main"],
        },
        {
          icon: SettingsIcon,
          label: t("common:nav.settings"),
          href: `/${slug}/settings`,
          keywords: ["preferences", "config", "options"],
        },
        {
          icon: Users2Icon,
          label: t("common:nav.members"),
          href: `/${slug}/members`,
          keywords: ["users", "collaborators", "invite"],
        },
        ...(hasServerPermission(
          project?.permissions ?? 0,
          ServerPermission.DATABASE_VIEW,
        )
          ? [
              {
                icon: DatabaseIcon,
                label: t("common:nav.databases"),
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
          label: t("common:nav.apiKeys"),
          href: `/${slug}/api-keys`,
          keywords: ["token", "api", "automation", "integration"],
        },
      ],
    },
    {
      heading: t("navigation:command.sections.account"),
      items: [
        {
          icon: UserIcon,
          label: t("navigation:command.items.profile"),
          action: () => openSettings("profile"),
          keywords: ["personal", "details", "account", "settings"],
        },
        {
          icon: KeyRoundIcon,
          label: t("common:resources.daemonAuth"),
          action: () => openSettings("daemon"),
          keywords: ["ssh", "sftp", "password", "keys"],
        },
        {
          icon: BellIcon,
          label: t("navigation:command.items.notifications"),
          href: "/settings/notifications",
          disabled: true,
          keywords: ["alerts", "messages"],
        },
      ],
    },
    {
      heading: t("navigation:command.sections.theme"),
      items: [
        {
          icon: theme === "dark" ? SunIcon : MoonIcon,
          label:
            theme === "dark"
              ? t("navigation:command.items.lightMode")
              : t("navigation:command.items.darkMode"),
          shortcut: "T",
          action: () => setTheme(theme === "dark" ? "light" : "dark"),
          keywords: ["dark", "light", "appearance", "mode"],
        },
      ],
    },
    {
      heading: t("navigation:command.sections.session"),
      items: [
        {
          icon: LogOutIcon,
          label: t("navigation:command.items.signOut"),
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

  const accountHeading = t("navigation:command.sections.account");
  const sessionHeading = t("navigation:command.sections.session");
  const filteredSections = session
    ? sections
    : sections.filter(
        (section) =>
          section.heading !== accountHeading &&
          section.heading !== sessionHeading,
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
          <span className="text-muted-foreground">
            {t("navigation:command.searchTrigger")}
          </span>
          <div className="ml-auto flex items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">
            <span className="text-xs">⌘</span>K
          </div>
        </div>
      </div>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command
          items={filteredSections}
          itemToStringValue={(item) => (item as CommandMenuItem).label}
          filter={(item, query) => matchesQuery(item as CommandMenuItem, query)}
        >
          <CommandInput
            placeholder={t("navigation:command.inputPlaceholder")}
          />
          <CommandEmpty>{t("common:state.noResultsFound")}</CommandEmpty>
          <CommandList>
            {(section: CommandMenuSection) => (
              <CommandGroup
                key={section.heading}
                items={section.items}
                heading={section.heading}
              >
                <CommandCollection>
                  {(item: CommandMenuItem) => (
                    <CommandItem
                      key={item.label}
                      value={item}
                      disabled={item.disabled}
                      onClick={() => runCommand(item)}
                      className="cursor-pointer"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <CommandShortcut>{item.shortcut}</CommandShortcut>
                      )}
                    </CommandItem>
                  )}
                </CommandCollection>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  );
}

function matchesQuery(item: CommandMenuItem, query: string) {
  const needle = query.trim().toLowerCase();
  return (
    !needle ||
    item.label.toLowerCase().includes(needle) ||
    (item.keywords ?? []).some((keyword) =>
      keyword.toLowerCase().includes(needle),
    )
  );
}
