"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Clock,
  Copy,
  Database,
  Pause,
  Play,
  RotateCcw,
  Server,
  ShieldAlert,
  Waypoints,
} from "lucide-react";
import { toast } from "sonner";

import { DATABASE_TYPE_LABELS } from "@/components/databases/database-type";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { powerInstanceAction } from "@/actions/databases";
import { useAction } from "@/lib/action-hooks";
import type { ListProjectInstancesResponses } from "@/lib/api";
import {
  controlsFromState,
  formatCpuPercent,
  formatUptime,
  formatUsageCompact,
  statusFromLabel,
  statusLabel,
  statusVariant,
} from "@/lib/server-status";
import type { PowerAction } from "@/types/database.schema";
import { useTranslation } from "react-i18next";

export type ProjectInstance = ListProjectInstancesResponses[200][number];

const BYTES_PER_MIB = 1024 * 1024;

function toMib(bytes: number | null | undefined) {
  return bytes == null ? null : bytes / BYTES_PER_MIB;
}

const COMMAND_SENT_KEYS: Record<PowerAction, string> = {
  start: "project:databases.managementBar.startCommandSent",
  restart: "project:databases.managementBar.restartCommandSent",
  stop: "project:databases.managementBar.stopCommandSent",
  kill: "project:databases.managementBar.killCommandSent",
};

export function InstanceManagementBar({
  projectId,
  instance,
  canManage,
  onChanged,
}: {
  projectId: string;
  instance: ProjectInstance;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [pendingAction, setPendingAction] = useState<PowerAction | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);

  const address = `${instance.host}:${instance.port}`;
  const status = statusFromLabel(instance.state);
  const controls = useMemo(() => controlsFromState(status), [status]);
  const disableAllButtons =
    !canManage || pendingAction !== null || instance.suspended;

  const power = useAction(powerInstanceAction, {
    onSuccess: () => {
      if (pendingAction) toast.success(t(COMMAND_SENT_KEYS[pendingAction]));
      setPendingAction(null);
      onChanged();
    },
    onError: (result) => {
      toast.error(
        result.error.serverError ?? t("project:databases.managementBar.powerError"),
      );
      setPendingAction(null);
    },
  });

  useEffect(() => {
    if (!addressCopied) return;

    const timeout = setTimeout(() => setAddressCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [addressCopied]);

  const executePowerAction = (action: PowerAction) => {
    setPendingAction(action);
    void power.executeAsync({
      projectId,
      instanceId: instance.id,
      action,
    });
  };

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setAddressCopied(true);
      toast.success(t("project:databases.managementBar.addressCopied"));
    } catch {
      toast.error(t("project:databases.managementBar.addressCopyFailed"));
    }
  };

  const utilization = instance.utilization;
  const uptimeMs = status === "running" ? (utilization?.uptime ?? null) : null;

  return (
    <Card className="border-border/70">
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-xl">{instance.display}</CardTitle>
              <Badge variant={statusVariant(status)}>
                {statusLabel(status)}
              </Badge>
              {instance.suspended ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="destructive">
                      {t("common:status.suspended")}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("project:databases.managementBar.suspendedTooltip")}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <button
                type="button"
                onClick={() => void handleCopyAddress()}
                title={t("project:databases.managementBar.copyAddressTitle")}
                className="group inline-flex items-center gap-1.5 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Waypoints className="size-4" />
                {address}
                {addressCopied ? (
                  <Check className="size-3.5 text-green-500" />
                ) : (
                  <Copy className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </button>
              <span className="inline-flex items-center gap-1.5">
                <Database className="size-4" />
                {DATABASE_TYPE_LABELS[instance.type]}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Server className="size-4" />
                {new Date(instance.created).toLocaleDateString()}
              </span>
              {uptimeMs !== null && (
                <span
                  className="inline-flex items-center gap-1.5"
                  title={t("project:databases.managementBar.uptimeTitle")}
                >
                  <Clock className="size-4" />
                  {formatUptime(uptimeMs)}
                </span>
              )}
              {!canManage && (
                <span className="inline-flex items-center gap-1.5 text-destructive">
                  {t("project:databases.managementBar.noPowerPermission")}
                </span>
              )}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => executePowerAction("start")}
              loading={pendingAction === "start"}
              disabled={disableAllButtons || !controls.canStart}
            >
              <Play className="size-4" />
              {t("common:resources.start")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => executePowerAction("restart")}
              loading={pendingAction === "restart"}
              disabled={disableAllButtons || !controls.canStop}
            >
              <RotateCcw className="size-4" />
              {t("project:databases.managementBar.restart")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => executePowerAction("stop")}
              loading={pendingAction === "stop"}
              disabled={disableAllButtons || !controls.canStop}
            >
              <Pause className="size-4" />
              {t("project:databases.managementBar.stop")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => executePowerAction("kill")}
              loading={pendingAction === "kill"}
              disabled={disableAllButtons || !controls.canKill}
            >
              <ShieldAlert className="size-4" />
              {t("project:databases.managementBar.kill")}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">{t("common:resources.cpu")}</p>
          <p className="mt-1 text-sm font-medium">
            {formatCpuPercent(utilization?.cpu_absolute)}
          </p>
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">{t("common:resources.memory")}</p>
          <p className="mt-1 text-sm font-medium">
            {formatUsageCompact(
              toMib(utilization?.memory_bytes),
              instance.memory_limit,
            )}
          </p>
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">{t("common:resources.disk")}</p>
          <p className="mt-1 text-sm font-medium">
            {formatUsageCompact(
              toMib(utilization?.disk_bytes),
              instance.disk_limit,
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
