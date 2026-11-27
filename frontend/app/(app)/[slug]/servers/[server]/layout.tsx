import { RedirectToSignin } from "@/lib/auth-redirect";
import Link from "@/components/link";
import { Outlet, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { MainLayout } from "@/components/sidebar/main-layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import type { listRoutes, serverInfo } from "@/lib/api";
import { useProject } from "@/hooks/use-project";
import { useServerInfo, useServerRoutes } from "@/hooks/use-shared-queries";
import {
  hasManagementPermission,
  hasServerPermission,
  ManagementPermission,
  mergePermissions,
  ServerPermission,
} from "@/lib/permissions";
import { ModpackInstallBanner } from "@/components/server/modpack-install-banner";
import { hasResourceSupport } from "@/lib/mod-browser/types";
import { ServerManagementBar } from "./components/management-bar/server-management-bar";
import { ServerLicenseNotice } from "./components/server-licenses";

type ServerRoutes = NonNullable<Awaited<ReturnType<typeof listRoutes>>["data"]>;

function getServerAddress(
  serverData: Awaited<ReturnType<typeof serverInfo>>["data"],
  routes: ServerRoutes | undefined,
) {
  if (!serverData) {
    return null;
  }

  const primary = serverData.primary_port;
  if (primary?.port.host && primary.external_port) {
    return `${primary.port.host}:${primary.external_port}`;
  }

  const route = routes?.find((entry) => entry.status === "active");
  if (route) {
    return route.fqdn;
  }

  const port = serverData.network?.ports.find(
    (entry) => entry.host && entry.external_port_start,
  );
  if (port) {
    return `${port.host}:${port.external_port_start}`;
  }

  return null;
}

export default function ServerLayout() {
  const { t } = useTranslation();
  const { slug = "", server = "" } = useParams<{
    slug: string;
    server: string;
  }>();

  const { data: session, isLoading: sessionLoading } = authClient.useSession();
  const { data: project, isLoading: projectLoading } = useProject(slug);
  const { data: infoResponse, isLoading: infoLoading } = useServerInfo(server);
  const canViewRoutes =
    session != null &&
    project != null &&
    hasServerPermission(
      mergePermissions(session.user.permissions, project.permissions),
      ServerPermission.ROUTES_VIEW,
    );
  const { data: routes } = useServerRoutes(canViewRoutes ? server : null);

  if (sessionLoading || projectLoading) return null;
  if (!session) return <RedirectToSignin />;

  if (!project) {
    return (
      <MainLayout
        breadcrumbs={[{ label: slug }, { label: t("common:nav.servers") }]}
      >
        <Card>
          <CardHeader>
            <CardTitle>{t("servers:layout.noProject.title")}</CardTitle>
            <CardDescription>
              {t("servers:layout.noProject.description")}
            </CardDescription>
          </CardHeader>
        </Card>
      </MainLayout>
    );
  }

  if (infoLoading) return null;

  const serverData =
    infoResponse && !infoResponse.error ? infoResponse.data : null;

  if (!serverData || serverData.project !== project.id) {
    return (
      <MainLayout
        breadcrumbs={[
          { label: slug, href: `/${slug}` },
          { label: t("common:nav.servers") },
        ]}
      >
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>{t("servers:layout.notFound.title")}</CardTitle>
            <CardDescription>
              {t("servers:layout.notFound.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              render={<Link href={`/${slug}`} />}
              nativeButton={false}
            >
              {t("servers:shared.backToServerList")}
            </Button>
          </CardContent>
        </Card>
      </MainLayout>
    );
  }

  const serverAddress = getServerAddress(serverData, routes);
  const effectivePermissions = mergePermissions(
    session.user.permissions,
    project.permissions,
  );

  const hasSuspensionBypassPermission =
    hasManagementPermission(
      effectivePermissions,
      ManagementPermission.SERVER_SUSPEND,
    ) ||
    hasManagementPermission(
      effectivePermissions,
      ManagementPermission.LIMITS_BYPASS,
    );
  const hasNodeMaintenanceBypassPermission =
    hasManagementPermission(
      effectivePermissions,
      ManagementPermission.NODES_MANAGE,
    ) ||
    hasManagementPermission(
      effectivePermissions,
      ManagementPermission.LIMITS_BYPASS,
    );

  const canManageServers = hasManagementPermission(
    effectivePermissions,
    ManagementPermission.SERVER_MANAGE,
  );

  const shouldBlockForSuspension =
    serverData.suspended && !hasSuspensionBypassPermission;
  const shouldBlockForNodeMaintenance =
    serverData.node.maintenance && !hasNodeMaintenanceBypassPermission;

  const blockReason = shouldBlockForSuspension
    ? "suspended"
    : shouldBlockForNodeMaintenance
      ? "maintenance"
      : null;

  return (
    <MainLayout
      breadcrumbs={[
        { label: slug, href: `/${slug}` },
        { label: t("common:nav.servers"), href: `/${slug}` },
        { label: serverData.name },
      ]}
    >
      <div className="flex flex-col gap-6">
        <ServerManagementBar
          serverId={serverData.id}
          serverName={serverData.name}
          address={serverAddress}
          nodeDisplay={serverData.node.display}
          template={serverData.template}
          suspended={serverData.suspended}
          suspensionReason={serverData.suspension_reason ?? null}
          nodeMaintenance={serverData.node.maintenance}
          adminHref={
            canManageServers ? `/admin/servers/${serverData.id}` : undefined
          }
          actionsDisabled={
            Boolean(blockReason) ||
            !hasServerPermission(effectivePermissions, ServerPermission.POWER)
          }
          disabledReason={
            blockReason ? undefined : t("servers:layout.noPowerPermission")
          }
          cpuLimit={serverData.cpu ?? null}
          diskLimit={serverData.disk ?? null}
          ramLimit={serverData.ram ?? null}
          swapLimit={serverData.swap ?? null}
          initialState={serverData.state ?? null}
          initialStartedAt={serverData.started_at ?? null}
          initialStats={serverData.stats ?? null}
        />

        {blockReason ? null : (
          <ModpackInstallBanner
            serverId={serverData.id}
            enabled={hasResourceSupport(serverData.features ?? [])}
          />
        )}

        {blockReason ? null : (
          <ServerLicenseNotice
            serverId={serverData.id}
            canAccept={hasServerPermission(
              effectivePermissions,
              ServerPermission.POWER,
            )}
          />
        )}

        <Outlet />
        {/* section content rendered by the routed child page */}
      </div>
    </MainLayout>
  );
}
