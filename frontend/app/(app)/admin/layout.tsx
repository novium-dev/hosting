import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AdminSidebar } from "@/components/navigation/admin-sidebar";
import { AppFooter } from "@/components/app-footer";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { usePathname } from "@/lib/navigation";
import { hasAnyManagementPermission } from "@/lib/permissions";

const sectionTitleKeys: Record<string, string> = {
  "": "common:nav.overview",
  users: "common:nav.users",
  "api-keys": "common:nav.apiKeys",
  projects: "common:nav.projects",
  servers: "common:nav.servers",
  templates: "common:nav.templates",
  regions: "common:nav.regions",
  nodes: "common:nav.nodes",
  groups: "navigation:adminSidebar.items.groups",
  "deploy-configs": "navigation:adminSidebar.items.deployConfigs",
  integrity: "admin-integrity:title",
};

export default function AdminLayout() {
  const { t } = useTranslation();
  const { data: session, isLoading } = authClient.useSession();
  const pathname = usePathname();

  if (isLoading) return null;

  if (!session || !hasAnyManagementPermission(session.user.permissions)) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-2xl font-semibold">{t("common:state.notFound")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("admin-core:layout.notFound.description")}
        </p>
      </div>
    );
  }

  const section = pathname.split("/").filter(Boolean)[1] ?? "";
  const sectionTitleKey = sectionTitleKeys[section];

  return (
    <SidebarProvider>
      <AdminSidebar permissions={session.user.permissions} />
      <SidebarInset>
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/70 md:px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <span className="text-sm font-medium">
            {sectionTitleKey
              ? t(sectionTitleKey)
              : t("admin-core:layout.defaultTitle")}
          </span>
        </header>
        <main className="w-full max-w-400">
          <Outlet />
        </main>
        <AppFooter className="mt-auto border-t" />
      </SidebarInset>
    </SidebarProvider>
  );
}
