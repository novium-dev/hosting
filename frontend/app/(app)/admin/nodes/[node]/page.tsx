import Link from "@/components/link";
import { useParams } from "react-router-dom";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  AlertTriangle,
  Cpu,
  Globe2,
  HardDrive,
  MemoryStick,
  Network,
  TerminalSquare,
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
import {
  availablePorts,
  listNodes,
  listRegions,
  metricsNode,
} from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { hasManagementPermission, ManagementPermission } from "@/lib/permissions";
import { NodePortsManager } from "./node-ports-manager";
import { NodeSettingsCard } from "./node-settings-card";

function formatBytes(value: number, t: TFunction) {
  if (!Number.isFinite(value) || value < 0) {
    return t("common:status.unknown");
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
  const { t } = useTranslation();
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
      const [nodesResponse, metricsResponse, availableResponse, regionsResponse] =
        await Promise.all([
          listNodes(),
          metricsNode({ path: { node_id: node } }).catch(() => null),
          availablePorts({ path: { node_id: node } }),
          listRegions(),
        ]);
      return {
        nodesResponse,
        metricsResponse,
        availableResponse,
        regionsResponse,
      };
    },
  );

  if (isLoading) return null;
  if (!session || !canView) return <NotFoundView />;
  if (!bundle) return null;

  const { nodesResponse, metricsResponse, availableResponse, regionsResponse } =
    bundle;
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
  const regions = regionsResponse.error ? [] : (regionsResponse.data ?? []);
  const currentRegion = regions.find(
    (region) => region.id === currentNode.region,
  );

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <CardTitle>{currentNode.display}</CardTitle>
              <CardDescription>
                {t("admin-infra:nodes.detailPage.nodeIdDescription", {
                  id: currentNode.id,
                })}
              </CardDescription>
            </div>

            <Button asChild variant="outline">
              <Link href="/admin/nodes">
                {t("admin-infra:nodes.detailPage.backToList")}
              </Link>
            </Button>
          </div>

          {hasMetricsError && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>
                {t("admin-infra:nodes.detailPage.metricsUnavailableTitle")}
              </AlertTitle>
              <AlertDescription>
                {t(
                  "admin-infra:nodes.detailPage.metricsUnavailableDescription",
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <InfoCard
              icon={Globe2}
              title={t("common:labels.region")}
              value={currentRegion?.display ?? currentNode.region}
            />
            <InfoCard
              icon={Network}
              title={t("common:nav.network")}
              value={`${currentNode.default_host} (${currentNode.default_bind})`}
            />
            {currentNode.ssh_host != null && currentNode.ssh_port != null && (
              <InfoCard
                icon={TerminalSquare}
                title={t("admin-infra:nodes.detailPage.sshLabel")}
                value={`${currentNode.ssh_host}:${currentNode.ssh_port}`}
              />
            )}
            <InfoCard
              icon={Cpu}
              title={t("common:resources.cpu")}
              value={
                metrics
                  ? t("admin-infra:nodes.detailPage.cpuValue", {
                      used: metrics.cpu_used.toFixed(2),
                      count: metrics.cpu_count.toFixed(0),
                    })
                  : t("admin-infra:nodes.detailPage.unavailable")
              }
            />
            <InfoCard
              icon={MemoryStick}
              title={t("common:resources.memory")}
              value={
                metrics
                  ? `${formatBytes(metrics.mem_used, t)} / ${formatBytes(metrics.mem_total, t)}`
                  : t("admin-infra:nodes.detailPage.unavailable")
              }
            />
            <InfoCard
              icon={HardDrive}
              title={t("admin-infra:nodes.detailPage.swapLabel")}
              value={
                metrics
                  ? `${formatBytes(metrics.swap_used, t)} / ${formatBytes(metrics.swap_total, t)}`
                  : t("admin-infra:nodes.detailPage.unavailable")
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
        initialRegion={currentNode.region}
        regions={regions}
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
