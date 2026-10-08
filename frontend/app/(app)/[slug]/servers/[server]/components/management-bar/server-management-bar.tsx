"use client";

import { Pause, Play, RotateCcw, Shield, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import Link from "@/components/link";
import { TaskLockNotice } from "@/components/server/task-lock-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  limitsOutOfDate,
  statusLabel,
  statusVariant,
  type StatsSnapshot,
} from "@/lib/server-status";
import { cn } from "@/lib/utils";
import { useServerTaskLock } from "@/stores/server-tasks";
import { HighUsageAlert, isHighUsage } from "./high-usage-alert";
import { ServerDetails } from "./server-details";
import { usePowerAction } from "./use-power-action";
import { useServerLiveState } from "./use-server-live-state";

type ServerManagementBarProps = {
  serverId: string;
  serverName: string;
  address: string | null;
  nodeDisplay: string;
  template: string;
  suspended: boolean;
  suspensionReason?: string | null;
  nodeMaintenance: boolean;
  actionsDisabled?: boolean;
  disabledReason?: string;
  adminHref?: string | null;
  cpuLimit: number | null;
  diskLimit: number | null;
  ramLimit: number | null;
  swapLimit: number | null;
  /** Initial daemon status label from server info, seeded before the websocket connects. */
  initialState?: string | null;
  /** Initial start timestamp (epoch ms) from server info. */
  initialStartedAt?: number | null;
  /** Initial resource usage snapshot from server info. */
  initialStats?: StatsSnapshot | null;
};

function UsageTile({
  label,
  value,
  high = false,
}: {
  label: string;
  value: string;
  high?: boolean;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-sm font-medium", high && "text-destructive")}>
        {value}
      </p>
    </div>
  );
}

export function ServerManagementBar({
  serverId,
  serverName,
  address,
  nodeDisplay,
  template,
  suspended,
  suspensionReason,
  nodeMaintenance,
  actionsDisabled = false,
  disabledReason,
  adminHref,
  cpuLimit,
  diskLimit,
  ramLimit,
  swapLimit,
  initialState,
  initialStartedAt,
  initialStats,
}: ServerManagementBarProps) {
  const { t } = useTranslation();
  const live = useServerLiveState({
    serverId,
    template,
    limits: { cpuLimit, diskLimit, ramLimit, swapLimit },
    initialState,
    initialStartedAt,
    initialStats,
  });
  const power = usePowerAction(serverId);
  const powerLock = useServerTaskLock(serverId, "server", "read");
  const startLock = useServerTaskLock(serverId, "server", "write");

  const { status, usage, usagePercents, controls } = live;
  const buttonsDisabled = power.pending !== null || actionsDisabled;
  const restartDisabled =
    buttonsDisabled || !controls.canStop || powerLock.locked;
  const staleLimits =
    (status === "running" || status === "unhealthy") &&
    limitsOutOfDate(live.runningLimits, { cpuLimit, ramLimit, swapLimit });
  const swapEnabled = usage.swap !== "Disabled";

  return (
    <div className="flex flex-col gap-4">
      {staleLimits && (
        <Alert className="border-amber-500/40 bg-amber-500/10">
          <RotateCcw className="size-4 text-amber-600 dark:text-amber-400" />
          <AlertTitle>
            {t("servers:managementBar.staleLimits.title")}
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{t("servers:managementBar.staleLimits.description")}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void power.execute("restart")}
              loading={power.pending === "restart"}
              disabled={restartDisabled}
            >
              <RotateCcw className="size-4" />
              {t("servers:managementBar.actions.restart")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <HighUsageAlert percents={usagePercents} />

      <Card className="border-border/70">
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-xl">{serverName}</CardTitle>
                <Badge variant={statusVariant(status)}>
                  {statusLabel(status)}
                </Badge>
              </div>
              <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <ServerDetails
                  address={address}
                  nodeDisplay={nodeDisplay}
                  template={template}
                  running={status === "running"}
                  startedAt={live.startedAt}
                  players={live.players}
                  suspended={suspended}
                  suspensionReason={suspensionReason}
                  nodeMaintenance={nodeMaintenance}
                />
                {actionsDisabled && disabledReason && (
                  <span className="inline-flex items-center gap-1.5 text-destructive">
                    {disabledReason}
                  </span>
                )}
                <TaskLockNotice lock={startLock} />
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {adminHref && (
                <Button
                  size="sm"
                  variant="outline"
                  render={<Link href={adminHref} />}
                  nativeButton={false}
                >
                  <Shield className="mr-2 size-4" />
                  {t("servers:managementBar.adminUiButton")}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={() => void power.execute("start")}
                loading={power.pending === "start"}
                disabled={
                  buttonsDisabled || !controls.canStart || startLock.locked
                }
              >
                <Play className="size-4" />
                {t("common:resources.start")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void power.execute("restart")}
                loading={power.pending === "restart"}
                disabled={restartDisabled}
              >
                <RotateCcw className="size-4" />
                {t("servers:managementBar.actions.restart")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => void power.execute("stop")}
                loading={power.pending === "stop"}
                disabled={
                  buttonsDisabled || !controls.canStop || powerLock.locked
                }
              >
                <Pause className="size-4" />
                {t("servers:managementBar.actions.stop")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void power.execute("kill")}
                loading={power.pending === "kill"}
                disabled={
                  buttonsDisabled || !controls.canKill || powerLock.locked
                }
              >
                <ShieldAlert className="size-4" />
                {t("servers:managementBar.actions.kill")}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent
          className={cn(
            "grid gap-4",
            swapEnabled ? "grid-cols-4" : "grid-cols-3",
          )}
        >
          <UsageTile
            label={t("common:resources.cpu")}
            value={usage.cpu}
            high={isHighUsage(usagePercents.cpu)}
          />
          <UsageTile
            label={t("servers:managementBar.stats.ram")}
            value={usage.ram}
            high={isHighUsage(usagePercents.ram)}
          />
          {swapEnabled && (
            <UsageTile
              label={t("servers:managementBar.stats.swap")}
              value={usage.swap}
            />
          )}
          <UsageTile
            label={t("common:resources.disk")}
            value={usage.disk}
            high={isHighUsage(usagePercents.disk)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
