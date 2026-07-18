import Link from "@/components/link";
import { useParams } from "react-router-dom";
import useSWR from "swr";
import { ExternalLink, Settings2, Wrench } from "lucide-react";

import { NotFoundView } from "@/components/not-found-view";
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
) {
  if (!serverData?.primary_port) {
    return "Address unavailable";
  }

  const host = serverData.primary_port.port.host;
  const port = serverData.primary_port.external_port;

  if (!host || !port) {
    return "Address unavailable";
  }

  return `${host}:${port}`;
}

export default function AdminServerManagementPage() {
  const { server = "" } = useParams<{ server: string }>();

  const { data: session, isLoading } = authClient.useSession();
  const canManage = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.SERVER_MANAGE,
      )
    : false;

  const { data: bundle } = useSWR(
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
  if (!canManage) return <NotFoundView />;
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
                  {data.suspended ? "Suspended" : "Active"}
                </Badge>
              </div>
              <CardDescription>
                ID: {data.id} | Project: {data.project}
              </CardDescription>
            </div>

            {panelPath ? (
              <Button asChild>
                <Link
                  href={panelPath}
                  className="inline-flex items-center gap-2"
                >
                  <ExternalLink className="size-4" />
                  View In Hephaestus
                </Link>
              </Button>
            ) : (
              <Button type="button" disabled>
                <ExternalLink className="size-4" />
                View In Hephaestus (Org not found)
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <InfoItem label="Template" value={data.template} />
            <InfoItem label="Node" value={data.node.display} />
            <InfoItem label="Address" value={getServerAddress(data)} />
            <InfoItem
              label="Limits"
              value={`CPU ${data.cpu ?? "--"}, RAM ${data.ram ?? "--"}, Disk ${data.disk ?? "--"}`}
            />
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="ports" className="space-y-4">
        <TabsList>
          <TabsTrigger value="ports" className="inline-flex items-center gap-2">
            <Settings2 className="size-4" />
            Ports
          </TabsTrigger>
          <TabsTrigger
            value="settings"
            className="inline-flex items-center gap-2"
          >
            <Settings2 className="size-4" />
            Settings
          </TabsTrigger>
          <TabsTrigger
            value="actions"
            className="inline-flex items-center gap-2"
          >
            <Wrench className="size-4" />
            Actions
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
