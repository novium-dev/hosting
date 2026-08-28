import Link from "@/components/link";
import { useParams } from "react-router-dom";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Boxes, ExternalLink, Settings2, Wrench } from "lucide-react";

import { NotFoundView } from "@/components/not-found-view";
import { appConfig } from "@/constants/config";
import { auth } from "@/lib/auth";
import { authClient } from "@/lib/auth-client";
import { serverInfo } from "@/lib/api";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PortsManager } from "./ports-manager";
import { extractAdminPorts } from "./port-utils";
import { ServerAdminSettings } from "./server-admin-settings";
import { ServerDeleteCard } from "./server-delete-card";
import { ServerTemplateCard } from "./server-template-card";

function getPanelPath(
  ownerId: string,
  serverId: string,
  organizations: Array<{ id: string; slug: string }>,
) {
  const ownerOrg = organizations.find((org) => org.id === ownerId);
  return ownerOrg ? `/${ownerOrg.slug}/servers/${serverId}` : null;
}

function getServerAddress(
  serverData: Awaited<ReturnType<typeof serverInfo>>["data"],
  t: TFunction,
) {
  if (!serverData?.primary_port) {
    return t("admin-infra:servers.detailPage.addressUnavailable");
  }

  const host = serverData.primary_port.port.host;
  const port = serverData.primary_port.external_port;

  if (!host || !port) {
    return t("admin-infra:servers.detailPage.addressUnavailable");
  }

  return `${host}:${port}`;
}

export default function AdminServerManagementPage() {
  const { t } = useTranslation();
  const { server = "" } = useParams<{ server: string }>();

  const { data: session, isLoading } = authClient.useSession();
  const canManage = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.SERVER_MANAGE,
      )
    : false;

  const { data: bundle, mutate } = useSWR(
    canManage && server ? ["admin-server", server] : null,
    async () => {
      const [serverResponse, organizations] = await Promise.all([
        serverInfo({ path: { server_id: server } }),
        auth.api.listOrganizations(),
      ]);
      return {
        data: serverResponse.error ? null : serverResponse.data,
        organizations,
      };
    },
  );

  if (isLoading) return null;
  if (!session || !canManage) return <NotFoundView />;
  if (!bundle) return null;

  const data = bundle.data;
  const organizations = bundle.organizations;

  if (!data) return <NotFoundView />;

  const panelPath = getPanelPath(data.project, data.id, organizations);
  const initialPorts = extractAdminPorts(data);
  const canManageServers = hasManagementPermission(
    session.user.permissions,
    ManagementPermission.SERVER_MANAGE,
  );
  const canSuspendServers = hasManagementPermission(
    session.user.permissions,
    ManagementPermission.SERVER_SUSPEND,
  );
  const canDeleteServers = hasManagementPermission(
    session.user.permissions,
    ManagementPermission.SERVER_DELETE,
  );

  const initialAdminSettings = {
    internetAccess: data.internet_access,
    suspended: data.suspended,
    suspensionReason: data.suspension_reason ?? null,
    backupLimit: data.limits.backup ?? null,
    cpu: data.cpu ?? null,
    ram: data.ram ?? null,
    swap: data.swap ?? null,
    disk: data.disk ?? null,
    customDockerfile: null,
  };

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{data.name}</CardTitle>
                <Badge variant={data.suspended ? "destructive" : "default"}>
                  {data.suspended
                    ? t("common:status.suspended")
                    : t("common:status.active")}
                </Badge>
              </div>
              <CardDescription>
                {t("admin-infra:servers.detailPage.idProjectDescription", {
                  id: data.id,
                  project: data.project,
                })}
              </CardDescription>
              {data.suspended && data.suspension_reason ? (
                <CardDescription className="text-destructive">
                  {t("admin-infra:servers.detailPage.suspendedReason", {
                    reason: data.suspension_reason,
                  })}
                </CardDescription>
              ) : null}
            </div>

            {panelPath ? (
              <Button asChild>
                <Link
                  href={panelPath}
                  className="inline-flex items-center gap-2"
                >
                  <ExternalLink className="size-4" />
                  {t("admin-infra:servers.detailPage.viewInHephaestus", {
                    appName: appConfig.appName,
                  })}
                </Link>
              </Button>
            ) : (
              <Button type="button" disabled>
                <ExternalLink className="size-4" />
                {t(
                  "admin-infra:servers.detailPage.viewInHephaestusOrgMissing",
                  { appName: appConfig.appName },
                )}
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <InfoItem
              label={t("admin-infra:servers.shared.templateLabel")}
              value={data.template}
            />
            <InfoItem
              label={t("admin-infra:servers.shared.nodeLabel")}
              value={data.node.display}
            />
            <InfoItem
              label={t("common:labels.address")}
              value={getServerAddress(data, t)}
            />
            <InfoItem
              label={t("admin-infra:servers.detailPage.limitsLabel")}
              value={t("admin-infra:servers.detailPage.limitsValue", {
                cpu: data.cpu ?? "--",
                ram: data.ram ?? "--",
                disk: data.disk ?? "--",
              })}
            />
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="ports" className="space-y-4">
        <TabsList>
          <TabsTrigger value="ports" className="inline-flex items-center gap-2">
            <Settings2 className="size-4" />
            {t("common:nav.ports")}
          </TabsTrigger>
          <TabsTrigger
            value="settings"
            className="inline-flex items-center gap-2"
          >
            <Settings2 className="size-4" />
            {t("common:nav.settings")}
          </TabsTrigger>
          <TabsTrigger
            value="template"
            className="inline-flex items-center gap-2"
          >
            <Boxes className="size-4" />
            {t("admin-infra:servers.shared.templateLabel")}
          </TabsTrigger>
          <TabsTrigger
            value="actions"
            className="inline-flex items-center gap-2"
          >
            <Wrench className="size-4" />
            {t("common:labels.actions")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ports">
          <PortsManager
            serverId={data.id}
            nodeId={data.node.id}
            initialPorts={initialPorts}
            canManage={canManageServers}
          />
        </TabsContent>

        <TabsContent value="settings">
          <ServerAdminSettings
            serverId={data.id}
            canManage={canManageServers}
            canSuspend={canSuspendServers}
            initial={initialAdminSettings}
          />
        </TabsContent>

        <TabsContent value="template">
          <ServerTemplateCard
            serverId={data.id}
            currentTemplate={data.template}
            canManage={canManageServers}
            onChanged={() => void mutate()}
          />
        </TabsContent>

        <TabsContent value="actions">
          <ServerDeleteCard
            canDelete={canDeleteServers}
            serverId={data.id}
            serverName={data.name}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}
