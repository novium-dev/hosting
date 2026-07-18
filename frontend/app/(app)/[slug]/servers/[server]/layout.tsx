import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { MainLayout } from "@/components/sidebar/main-layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { appConfig } from "@/constants/config";
import { serverInfo } from "@/lib/api";
import {
  hasManagementPermission,
  hasServerPermission,
  ManagementPermission,
  mergePermissions,
  ServerPermission,
} from "@/lib/permissions";
import { ServerManagementBar } from "./components/server-management-bar";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{
    slug: string;
    server: string;
  }>;
};

function getServerAddress(
  serverData: Awaited<ReturnType<typeof serverInfo>>["data"],
) {
  if (!serverData) {
    return "Address unavailable";
  }

  const primary = serverData.primary_port;
  if (!primary) {
    return "Address unavailable";
  }

  const host = primary.port.host;
  const port = primary.external_port;

  if (!host || !port) {
    return "Address unavailable";
  }

  return `${host}:${port}`;
}

export default async function ServerLayout({ children, params }: LayoutProps) {
  const { slug, server } = await params;

  const requestHeaders = await headers();

  const session = await auth.api.getSession({
    headers: requestHeaders,
  });

  if (!session) {
    redirect(appConfig.authRoutes.signin);
  }

  const org = await auth.api.getFullOrganization({
    query: { organizationSlug: slug },
    headers: requestHeaders,
  });

  if (!org) {
    return (
      <MainLayout breadcrumbs={[{ label: slug }, { label: "Servers" }]}>
        <Card>
          <CardHeader>
            <CardTitle>No active organization selected</CardTitle>
            <CardDescription>
              Please select an organization before viewing this server.
            </CardDescription>
          </CardHeader>
        </Card>
      </MainLayout>
    );
  }

  const infoResponse = await serverInfo({
    path: { server_id: server },
    headers: requestHeaders,
  });

  const serverData = infoResponse.error ? null : infoResponse.data;

  if (!serverData || serverData.project !== org.id) {
    return (
      <MainLayout
        breadcrumbs={[{ label: slug, href: `/${slug}` }, { label: "Servers" }]}
      >
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Server not found</CardTitle>
            <CardDescription>
              This server does not exist or is not part of your organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href={`/${slug}`}>Back to server list</Link>
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
        { label: "Servers", href: `/${slug}` },
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
          nodeMaintenance={serverData.node.maintenance}
          adminHref={
            canManageServers ? `/admin/servers/${serverData.id}` : undefined
          }
          actionsDisabled={
            Boolean(blockReason) ||
            !hasServerPermission(effectivePermissions, ServerPermission.POWER)
          }
          disabledReason={
            blockReason
              ? undefined
              : "You do not have permission to control power."
          }
          cpuLimit={serverData.cpu ?? null}
          diskLimit={serverData.disk ?? null}
          ramLimit={serverData.ram ?? null}
          swapLimit={serverData.swap ?? null}
        />

        {children}
      </div>
    </MainLayout>
  );
}
