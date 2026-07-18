import Link from "@/components/link";
import { useParams } from "react-router-dom";
import useSWR from "swr";
import {
  AlertTriangle,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
} from "lucide-react";

import { NotFoundView } from "@/components/not-found-view";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { availablePorts, listNodes, metricsNode } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { hasManagementPermission, ManagementPermission } from "@/lib/permissions";
import { NodePortsManager } from "./node-ports-manager";
import { NodeSettingsCard } from "./node-settings-card";

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return "Unknown";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = units[0];

  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }

  return `${size.toFixed(2)} ${unit}`;
}

export default function AdminNodeManagementPage() {
  const { node = "" } = useParams<{ node: string }>();

  const { data: session, isLoading } = authClient.useSession();
  const canView = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.NODES_VIEW,
      )
    : false;

  const { data: bundle } = useSWR(
    canView && node ? ["admin-node", node] : null,
    async () => {
      const [nodesResponse, metricsResponse, availableResponse] =
        await Promise.all([
          listNodes(),
          metricsNode({ path: { node_id: node } }).catch(() => null),
          availablePorts({ path: { node_id: node } }),
        ]);
      return { nodesResponse, metricsResponse, availableResponse };
    },
  );

  if (isLoading) return null;
  if (!canView) return <NotFoundView />;
  if (!bundle) return null;

  const { nodesResponse, metricsResponse, availableResponse } = bundle;
  const nodes = nodesResponse.error ? [] : (nodesResponse.data ?? []);
  const currentNode = nodes.find((entry) => entry.id === node) ?? null;

  if (!currentNode) return <NotFoundView />;

  const metrics =
    !metricsResponse || metricsResponse.error ? null : metricsResponse.data;
  const hasMetricsError = !metrics;
  const available = availableResponse.error
    ? {}
    : (availableResponse.data ?? {});
  const canManageNodes = hasManagementPermission(
    session.user.permissions,
    ManagementPermission.NODES_MANAGE,
  );

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <CardTitle>{currentNode.display}</CardTitle>
              <CardDescription>Node ID: {currentNode.id}</CardDescription>
            </div>

            <Button asChild variant="outline">
              <Link href="/admin/nodes">Back to node list</Link>
            </Button>
          </div>

          {hasMetricsError && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>Node metrics unavailable</AlertTitle>
              <AlertDescription>
                The metrics endpoint did not respond successfully. This node is
                likely offline or unreachable.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <InfoCard
              icon={Network}
              title="Network"
              value={`${currentNode.default_host} (${currentNode.default_bind})`}
            />
            <InfoCard
              icon={Cpu}
              title="CPU"
              value={
                metrics
                  ? `${metrics.cpu_used.toFixed(2)} / ${metrics.cpu_count.toFixed(0)} cores`
                  : "Unavailable"
              }
            />
            <InfoCard
              icon={MemoryStick}
              title="Memory"
              value={
                metrics
                  ? `${formatBytes(metrics.mem_used)} / ${formatBytes(metrics.mem_total)}`
                  : "Unavailable"
              }
            />
            <InfoCard
              icon={HardDrive}
              title="Swap"
              value={
                metrics
                  ? `${formatBytes(metrics.swap_used)} / ${formatBytes(metrics.swap_total)}`
                  : "Unavailable"
              }
            />
          </div>
        </CardHeader>
      </Card>

      <NodePortsManager
        nodeId={currentNode.id}
        initialPorts={currentNode.ports}
        initialAvailablePorts={available}
        canManage={canManageNodes}
      />

      <NodeSettingsCard
        nodeId={currentNode.id}
        display={currentNode.display}
        defaultHost={currentNode.default_host}
        defaultBind={currentNode.default_bind}
        backupStorages={currentNode.backup_storages}
        serverStorages={currentNode.server_storages}
        initialMaintenance={currentNode.maintenance}
        canManage={canManageNodes}
      />
    </div>
  );
}

function InfoCard({
  icon: Icon,
  title,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-4" />
        {title}
      </p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}
