import Link from "@/components/link";
import { Navigate, Outlet, useParams } from "react-router-dom";
import useSWR from "swr";
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
import { appConfig } from "@/constants/config";
import { serverInfo } from "@/lib/api";
import { useOrganization } from "@/hooks/use-organization";
import {
  hasManagementPermission,
  hasServerPermission,
  ManagementPermission,
  mergePermissions,
  ServerPermission,
} from "@/lib/permissions";
import { ServerManagementBar } from "./components/server-management-bar";

function getServerAddress(
  serverData: Awaited<ReturnType<typeof serverInfo>>["data"],
) {
  if (!serverData) {
    return null;
  }

  const primary = serverData.primary_port;
  if (!primary) {
    return null;
  }

  const host = primary.port.host;
  const port = primary.external_port;

  if (!host || !port) {
    return null;
  }

  return `${host}:${port}`;
}

export default function ServerLayout() {
  const { t } = useTranslation();
  const { slug = "", server = "" } = useParams<{
    slug: string;
    server: string;
  }>();

  const { data: session, isLoading: sessionLoading } = authClient.useSession();
  const { data: org, isLoading: orgLoading } = useOrganization(slug);
  const { data: infoResponse, isLoading: infoLoading } = useSWR(
    server ? ["server-info", server] : null,
    () => serverInfo({ path: { server_id: server! } }),
  );

  if (sessionLoading || orgLoading) return null;
  if (!session) return <Navigate to={appConfig.authRoutes.signin} replace />;

  if (!org) {
    return (
      <MainLayout
        breadcrumbs={[
          { label: slug },
          { label: t("common:nav.servers") },
        ]}
      >
        <Card>
          <CardHeader>
            <CardTitle>{t("servers:layout.noOrganization.title")}</CardTitle>
            <CardDescription>
              {t("servers:layout.noOrganization.description")}
            </CardDescription>
          </CardHeader>
        </Card>
      </MainLayout>
    );
  }

  if (infoLoading) return null;

  const serverData =
    infoResponse && !infoResponse.error ? infoResponse.data : null;

  if (!serverData || serverData.project !== org.id) {
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
            <Button asChild variant="outline">
              <Link href={`/${slug}`}>{t("servers:shared.backToServerList")}</Link>
            </Button>
          </CardContent>
        </Card>
      </MainLayout>
    );
  }

  const serverAddress = getServerAddress(serverData);
  const effectivePermissions = mergePermissions(
    session.user.permissions,
    org.permissions,
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

        <Outlet />
        {/* section content rendered by the routed child page */}
      </div>
    </MainLayout>
  );
}
