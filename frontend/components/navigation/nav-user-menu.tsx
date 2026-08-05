"use client";

import {
  Bell,
  ChevronsUpDown,
  LogOut,
  Moon,
  Settings,
  Sun,
} from "lucide-react";

import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { appConfig } from "@/constants/config";
import { authClient } from "@/lib/auth-client";
import { useTheme } from "@/components/theme-provider";
import { useRouter } from "@/lib/navigation";
import { useSettingsDialog } from "@/hooks/use-settings-dialog";

export function NavUserMenu({
  variant = "default",
}: {
  variant?: "default" | "sidebar";
}) {
  const router = useRouter();
  const { open: openSettings } = useSettingsDialog();
  const { t } = useTranslation();

  const { data: session } = authClient.useSession();
  const { theme, setTheme } = useTheme();

  const isSidebar = variant === "sidebar";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {isSidebar ? (
          <SidebarMenuButton size="lg">
            <Avatar className="size-8 rounded-lg">
              <AvatarImage
                src={session?.user?.image ?? ""}
                alt={session?.user?.name}
              />
              <AvatarFallback className="rounded-lg">
                {session?.user?.name?.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">
                {session?.user?.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {session?.user?.email}
              </span>
            </div>
            <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
          </SidebarMenuButton>
        ) : (
          <Button variant="ghost" className="h-9 gap-2 px-2">
            <Avatar className="h-7 w-7 rounded-lg">
              <AvatarImage
                src={session?.user?.image ?? ""}
                alt={session?.user?.name}
              />
              <AvatarFallback className="rounded-lg">
                {session?.user?.name?.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div className="hidden max-w-36 text-left text-sm leading-tight md:grid">
              <span className="truncate font-semibold">
                {session?.user?.name}
              </span>
            </div>
            <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="min-w-56 rounded-lg"
        side={isSidebar ? "right" : "bottom"}
        align="end"
        sideOffset={8}
      >
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
            <Avatar className="h-8 w-8 rounded-lg">
              <AvatarImage
                src={session?.user?.image ?? ""}
                alt={session?.user?.name}
              />
              <AvatarFallback className="rounded-lg">
                {session?.user?.name?.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">
                {session?.user?.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {session?.user?.email}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => openSettings("profile")}
            className="w-full cursor-pointer"
          >
            <Settings className="size-4" />
            <span className="text-sm">
              {t("navigation:userMenu.profileSettings")}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <Bell className="size-4" />
            {t("navigation:userMenu.notifications")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="cursor-pointer"
        >
          {theme === "dark" ? (
            <>
              <Sun className="h-4 w-4 mr-2" />
              {t("navigation:userMenu.lightMode")}
            </>
          ) : (
            <>
              <Moon className="h-4 w-4 mr-2" />
              {t("navigation:userMenu.darkMode")}
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            authClient.signOut({
              fetchOptions: {
                onSuccess: () => router.push(appConfig.authRoutes.signin),
              },
            })
          }
          className="cursor-pointer"
        >
          <LogOut className="h-4 w-4 mr-2" />
          {t("navigation:userMenu.logOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
