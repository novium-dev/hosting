import Link from "@/components/link";
import { Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { OrganizationSwitcher } from "@/components/sidebar/organization-switcher";
import { NavPlatformTabs } from "./nav-platform-tabs";
import { NavUserMenu } from "./nav-user-menu";
import { hasAnyManagementPermission } from "@/lib/permissions";

export function OrganizationNavbar({
  user,
}: {
  user: {
    permissions?: number | null | undefined;
    role?: string | null | undefined;
  };
}) {
  const canAccessAdmin = hasAnyManagementPermission(user.permissions ?? 0);
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-400 items-center gap-2 px-3 md:px-4">
        <div className="shrink-0">
          <OrganizationSwitcher />
        </div>

        <div className="hidden min-w-0 flex-1 lg:flex lg:justify-center">
          <NavPlatformTabs />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {canAccessAdmin && (
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/users">
                <Shield className="mr-2 h-4 w-4" />
                {t("navigation:organizationNavbar.admin")}
              </Link>
            </Button>
          )}

          <NavUserMenu />
        </div>
      </div>

      <div className="border-t px-3 py-2 lg:hidden md:px-4">
        <NavPlatformTabs />
      </div>
    </header>
  );
}
