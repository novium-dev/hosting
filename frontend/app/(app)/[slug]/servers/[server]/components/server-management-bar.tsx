"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "@/components/link";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Globe,
  Pause,
  Play,
  RotateCcw,
  Server,
  Shield,
  ShieldAlert,
  Users,
  Waypoints,
} from "lucide-react";
import { toast } from "sonner";

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
  killServer,
  restartServer,
  serverStats,
  startServer,
  stopServer,
} from "@/lib/api";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  readServerPlayers,
  supportsPlayers,
  type ServerPlayers,
} from "@/lib/server-players";
import {
  useForgetServerStats,
  usePublishServerStats,
} from "@/stores/server-stats";
import {
  useForgetServerStatus,
  usePublishServerStatus,
} from "@/stores/server-status";
import {
  useForgetServerTasks,
  usePublishServerTasks,
  useServerTaskLock,
} from "@/stores/server-tasks";
import { EMPTY_SERVER_TASKS, readServerTasks } from "@/lib/server-tasks";
import { TaskLockNotice } from "@/components/server/task-lock-notice";
import { cn, titleCase } from "@/lib/utils";
import {
  HIGH_USAGE_SUSTAIN_MS,
  HIGH_USAGE_THRESHOLD,
  buildBaseUsage,
  controlsFromState,
  deriveInitialUsage,
  formatCpuUsage,
  formatUptime,
  formatUsage,
  limitsOutOfDate,
  readRunningLimits,
  statusFromLabel,
  statusLabel,
  statusVariant,
  toFiniteNumber,
  usagePercentValue,
  type ControlState,
  type RunningLimits,
  type ServerLifecycleState,
  type StatsSnapshot,
  type UsagePercents,
  type UsageState,
} from "@/lib/server-status";
import type { PowerAction } from "@/lib/api";

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

type StatsConnection = "connecting" | "connected" | "disconnected";

export const DISK_USAGE_EVENT = "server-disk-usage";

export type DiskUsageEventDetail = {
  serverId: string;
  percent: number | null;
};

function readString(
  data: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function readBoolean(
  data: Record<string, unknown>,
  keys: string[],
): boolean | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "boolean") {
      return value;
    }
  }

  return null;
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
  const baseUsage = useMemo(
    () => buildBaseUsage({ cpuLimit, diskLimit, ramLimit, swapLimit }),
    [cpuLimit, diskLimit, ramLimit, swapLimit],
  );

  // Seed from server info so the bar renders the real state/usage before (and
  // even without) a working stats websocket. "unknown" is only shown when the
  // daemon status is genuinely absent.
  const initialUsage = useMemo(
    () =>
      deriveInitialUsage(
        initialStats,
        { cpuLimit, diskLimit, ramLimit, swapLimit },
        baseUsage,
      ),
    [initialStats, cpuLimit, diskLimit, ramLimit, swapLimit, baseUsage],
  );
  const seededStatus: ServerLifecycleState = initialState
    ? statusFromLabel(initialState)
    : "unknown";

  const [status, setStatus] = useState<ServerLifecycleState>(seededStatus);
  const [usage, setUsage] = useState<UsageState>(initialUsage.usage);
  const [usagePercents, setUsagePercents] = useState<UsagePercents>(
    initialUsage.percents,
  );
  const [connection, setConnection] = useState<StatsConnection>("connecting");
  const [pendingAction, setPendingAction] = useState<PowerAction | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(
    initialStartedAt ?? null,
  );
  const [now, setNow] = useState<number>(() => Date.now());
  const [players, setPlayers] = useState<ServerPlayers | null>(null);
  const [controls, setControls] = useState<ControlState>(() =>
    controlsFromState(seededStatus),
  );
  const [runningLimits, setRunningLimits] = useState<RunningLimits | null>(() =>
    readRunningLimits(initialStats),
  );
  const [highUsageVisible, setHighUsageVisible] = useState(false);
  const [highUsageAlert, setHighUsageAlert] = useState<{
    cpu: number | null;
    ram: number | null;
  }>({ cpu: null, ram: null });

  const publishStatus = usePublishServerStatus();
  const forgetStatus = useForgetServerStatus();
  const publishStats = usePublishServerStats();
  const forgetStats = useForgetServerStats();
  const publishTasks = usePublishServerTasks();
  const forgetTasks = useForgetServerTasks();

  const powerLock = useServerTaskLock(serverId, "server", "read");
  const startLock = useServerTaskLock(serverId, "server", "write");

  useEffect(() => {
    publishStatus(serverId, status);
  }, [publishStatus, serverId, status]);

  useEffect(() => () => forgetStatus(serverId), [forgetStatus, serverId]);

  useEffect(() => () => forgetStats(serverId), [forgetStats, serverId]);

  useEffect(() => () => forgetTasks(serverId), [forgetTasks, serverId]);

  const disableAllButtons = pendingAction !== null || actionsDisabled;
  const canRestart = controls.canStop;

  const connectionLabel = useMemo(() => {
    if (connection === "connected") {
      return "live";
    }

    if (connection === "connecting") {
      return "connecting";
    }

    return "disconnected";
  }, [connection]);

  useEffect(() => {
    setUsage(initialUsage.usage);
    setUsagePercents(initialUsage.percents);
  }, [initialUsage]);

  const limitsRef = useRef({ cpuLimit, diskLimit, ramLimit, swapLimit });
  useEffect(() => {
    limitsRef.current = { cpuLimit, diskLimit, ramLimit, swapLimit };
  }, [cpuLimit, diskLimit, ramLimit, swapLimit]);

  useEffect(() => {
    if (!addressCopied) {
      return;
    }

    const timeout = setTimeout(() => setAddressCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [addressCopied]);

  useEffect(() => {
    if (status !== "running" || startedAt === null) {
      return;
    }

    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [status, startedAt]);

  useEffect(() => {
    let mounted = true;
    let socket: WebSocket | null = null;

    const connectStats = async () => {
      try {
        const statsUrl = await serverStats({ path: { server_id: serverId } });

        if (statsUrl.error) {
          if (mounted) {
            setConnection("disconnected");
            toast.error(t("servers:managementBar.toasts.statsConnectFailed"));
          }
          return;
        }

        const socketUrl = statsUrl.data;
        if (!socketUrl) {
          if (mounted) {
            setConnection("disconnected");
            toast.error(t("servers:managementBar.toasts.invalidStatsUrl"));
          }
          return;
        }

        socket = new WebSocket(socketUrl);
        socket.binaryType = "arraybuffer";

        if (!mounted) {
          socket.close();
          return;
        }

        socket.onopen = () => {
          if (!mounted) {
            return;
          }

          setConnection("connected");
        };

        socket.onerror = () => {
          if (!mounted) {
            return;
          }

          setConnection("disconnected");
          publishTasks(serverId, EMPTY_SERVER_TASKS);
        };

        socket.onclose = () => {
          if (!mounted) {
            return;
          }

          setConnection("disconnected");
          publishTasks(serverId, EMPTY_SERVER_TASKS);
        };

        socket.onmessage = (event) => {
          if (!mounted || typeof event.data !== "string") {
            return;
          }

          const message = event.data;

          const nextTasks = readServerTasks(message);
          if (nextTasks) {
            publishTasks(serverId, nextTasks);
            return;
          }

          const nextPlayers = readServerPlayers(template, message);
          if (nextPlayers) {
            setPlayers(nextPlayers);
          }

          if (message.startsWith("STATS!")) {
            try {
              const payload = JSON.parse(message.slice(6)) as Record<
                string,
                unknown
              >;

              const nextRunningLimits = readRunningLimits(
                payload as StatsSnapshot,
              );
              if (nextRunningLimits) {
                setRunningLimits(nextRunningLimits);
              }

              const limits = limitsRef.current;
              const ramCurrent = payload.ram ?? payload.mem;
              const ramMax =
                payload.ram_max ?? payload.mem_max ?? limits.ramLimit;
              const cpuCurrent = payload.cpu;
              const cpuMax = payload.cpu_max ?? limits.cpuLimit;
              const diskCurrent = payload.disk ?? payload.storage;
              const diskMax =
                payload.disk_max ?? payload.storage_max ?? limits.diskLimit;
              const swapMax = payload.swap_max ?? limits.swapLimit;

              setUsage({
                cpu: formatCpuUsage(cpuCurrent, cpuMax),
                ram: formatUsage(ramCurrent, ramMax),
                disk: formatUsage(diskCurrent, diskMax),
                swap:
                  swapMax === 0
                    ? "Disabled"
                    : formatUsage(payload.swap, swapMax),
              });

              publishStats(serverId, {
                at: Date.now(),
                cpu: toFiniteNumber(cpuCurrent),
                cpuMax: toFiniteNumber(cpuMax),
                ram: toFiniteNumber(ramCurrent),
                ramMax: toFiniteNumber(ramMax),
                disk: toFiniteNumber(diskCurrent),
                diskMax: toFiniteNumber(diskMax),
              });

              const diskPercent = usagePercentValue(diskCurrent, diskMax);

              setUsagePercents({
                cpu: usagePercentValue(cpuCurrent, cpuMax),
                ram: usagePercentValue(ramCurrent, ramMax),
                disk: diskPercent,
              });

              // Notify the file manager so it can surface a disk-space alert.
              if (typeof window !== "undefined") {
                window.dispatchEvent(
                  new CustomEvent<DiskUsageEventDetail>(DISK_USAGE_EVENT, {
                    detail: {
                      serverId,
                      percent: diskPercent,
                    },
                  }),
                );
              }
            } catch {
              // Ignore malformed stats payloads.
            }

            return;
          }

          try {
            const payload = JSON.parse(message) as Record<string, unknown>;

            const start = readBoolean(payload, ["start", "START"]);
            const stop = readBoolean(payload, ["stop", "STOP"]);
            const kill = readBoolean(payload, ["kill", "KILL"]);
            const label = readString(payload, ["label", "LABEL"]);
            const time = toFiniteNumber(payload.time ?? payload.TIME);

            if (label) {
              setStatus(statusFromLabel(label));
            }

            setStartedAt(time !== null && time > 0 ? time : null);

            setControls((prev) => ({
              canStart: start ?? prev.canStart,
              canStop: stop ?? prev.canStop,
              canKill: kill ?? prev.canKill,
            }));
          } catch {
            // Ignore malformed control payloads.
          }
        };
      } catch (error) {
        console.error("Failed to connect to stats websocket", error);
        if (mounted) {
          setConnection("disconnected");
          toast.error("Failed to connect to server stats");
        }
      }
    };

    void connectStats();

    return () => {
      mounted = false;
      socket?.close();
    };
  }, [serverId, template, publishTasks, publishStats]);

  useEffect(() => {
    if (status !== "running") {
      setPlayers(null);
    }
  }, [status]);

  useEffect(() => {
    if (status !== "running" && status !== "unhealthy") {
      setRunningLimits(null);
    }
  }, [status]);

  const executePowerAction = async (action: PowerAction) => {
    setPendingAction(action);

    try {
      switch (action) {
        case "start": {
          const res = await startServer({ path: { server_id: serverId } });

          console.log("Start server response", res);

          if (res.error) {
            throw new Error(
              t("servers:managementBar.errors.startFailed", {
                msg: res.error.error?.msg,
              }),
            );
          }
          break;
        }
        case "stop": {
          const res = await stopServer({ path: { server_id: serverId } });

          if (res.error) {
            throw new Error(
              t("servers:managementBar.errors.stopFailed", {
                msg: res.error.error?.msg,
              }),
            );
          }
          break;
        }
        case "restart": {
          const res = await restartServer({ path: { server_id: serverId } });

          if (res.error) {
            throw new Error(
              t("servers:managementBar.errors.restartFailed", {
                msg: res.error.error?.msg,
              }),
            );
          }
          break;
        }
        case "kill": {
          const res = await killServer({ path: { server_id: serverId } });

          if (res.error) {
            throw new Error(
              t("servers:managementBar.errors.killFailed", {
                msg: res.error.error?.msg,
              }),
            );
            return;
          }
          break;
        }
      }

      toast.success(
        t("servers:managementBar.commandSent", {
          action: t(`servers:managementBar.actions.${action}`),
        }),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("common:state.genericError");
      toast.error(message);
    } finally {
      setPendingAction(null);
    }
  };

  const canCopyAddress = address !== null;
  const displayAddress =
    address ?? t("servers:managementBar.addressUnavailable");
  const uptimeMs =
    startedAt !== null ? now - startedAt : null;
  const playerCount = players
    ? players.max !== null
      ? `${players.online}/${players.max}`
      : String(players.online)
    : null;
  const playerNames = players?.list?.map((player) => player.name) ?? [];

  const handleCopyAddress = async () => {
    if (!canCopyAddress || !address) {
      return;
    }

    try {
      await navigator.clipboard.writeText(address);
      setAddressCopied(true);
      toast.success(t("servers:managementBar.toasts.addressCopied"));
    } catch {
      toast.error(t("servers:managementBar.toasts.addressCopyFailed"));
    }
  };

  const staleLimits =
    (status === "running" || status === "unhealthy") &&
    limitsOutOfDate(runningLimits, { cpuLimit, ramLimit, swapLimit });

  const cpuHigh =
    usagePercents.cpu !== null && usagePercents.cpu >= HIGH_USAGE_THRESHOLD;
  const ramHigh =
    usagePercents.ram !== null && usagePercents.ram >= HIGH_USAGE_THRESHOLD;
  const diskHigh =
    usagePercents.disk !== null && usagePercents.disk >= HIGH_USAGE_THRESHOLD;
  const highUsage = cpuHigh || ramHigh;

  useEffect(() => {
    if (highUsage === highUsageVisible) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setHighUsageVisible(highUsage);
    }, HIGH_USAGE_SUSTAIN_MS);

    return () => window.clearTimeout(timeout);
  }, [highUsage, highUsageVisible]);

  useEffect(() => {
    if (!highUsage) {
      return;
    }

    setHighUsageAlert({
      cpu: cpuHigh ? usagePercents.cpu : null,
      ram: ramHigh ? usagePercents.ram : null,
    });
  }, [highUsage, cpuHigh, ramHigh, usagePercents]);

  return (
    <div className="space-y-4">
      {staleLimits && (
        <Alert className="border-amber-500/40 bg-amber-500/10">
          <RotateCcw className="size-4 text-amber-600 dark:text-amber-400" />
          <AlertTitle>{t("servers:managementBar.staleLimits.title")}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{t("servers:managementBar.staleLimits.description")}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => executePowerAction("restart")}
              loading={pendingAction === "restart"}
              disabled={disableAllButtons || !canRestart || powerLock.locked}
            >
              <RotateCcw className="size-4" />
              {t("servers:managementBar.actions.restart")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {highUsageVisible && (
        <Alert
          variant="destructive"
          className="border-destructive/40 bg-destructive/10"
        >
          <AlertTriangle className="size-4" />
          <AlertTitle>
            {highUsageAlert.cpu !== null && highUsageAlert.ram !== null
              ? t("servers:managementBar.highUsage.cpuAndRamTitle")
              : highUsageAlert.cpu !== null
                ? t("servers:managementBar.highUsage.cpuTitle")
                : t("servers:managementBar.highUsage.ramTitle")}
          </AlertTitle>
          <AlertDescription>
            {highUsageAlert.cpu !== null
              ? t("servers:managementBar.highUsage.cpuAtLimit", {
                  percent: highUsageAlert.cpu.toFixed(1),
                })
              : null}
            {highUsageAlert.ram !== null
              ? t("servers:managementBar.highUsage.ramAtLimit", {
                  percent: highUsageAlert.ram.toFixed(1),
                })
              : null}
            {t("servers:managementBar.highUsage.resourceWarning")}
          </AlertDescription>
        </Alert>
      )}

      <Card className="border-border/70">
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-xl">{serverName}</CardTitle>
                <Badge variant={statusVariant(status)}>
                  {statusLabel(status)}
                </Badge>
              </div>
              <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                {canCopyAddress ? (
                  <button
                    type="button"
                    onClick={handleCopyAddress}
                    title={t("servers:managementBar.copyAddressTitle")}
                    className="group inline-flex items-center gap-1.5 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Waypoints className="size-4" />
                    {displayAddress}
                    {addressCopied ? (
                      <Check className="size-3.5 text-green-500" />
                    ) : (
                      <Copy className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                    )}
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Waypoints className="size-4" />
                    {displayAddress}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <Server className="size-4" />
                  {nodeDisplay}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Globe className="size-4" />
                  {titleCase(template)}
                </span>
                {uptimeMs !== null && (
                  <span
                    className="inline-flex items-center gap-1.5"
                    title={t("servers:managementBar.uptimeTitle")}
                  >
                    <Clock className="size-4" />
                    {formatUptime(uptimeMs)}
                  </span>
                )}
                {playerCount && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="size-4" />
                        {playerCount}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {playerNames.length > 0 ? (
                        <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                          {playerNames.map((name) => (
                            <span key={name}>{name}</span>
                          ))}
                        </div>
                      ) : (
                        t("servers:managementBar.playersOnline")
                      )}
                    </TooltipContent>
                  </Tooltip>
                )}
                {suspended &&
                  (suspensionReason ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="destructive">
                          {t("servers:managementBar.suspendedBadge")}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>{suspensionReason}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Badge variant="destructive">
                      {t("servers:managementBar.suspendedBadge")}
                    </Badge>
                  ))}
                {nodeMaintenance && (
                  <Badge variant="destructive">
                    {t("servers:managementBar.maintenanceBadge")}
                  </Badge>
                )}
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
                <Button asChild size="sm" variant="outline">
                  <Link href={adminHref}>
                    <Shield className="mr-2 size-4" />
                    {t("servers:managementBar.adminUiButton")}
                  </Link>
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={() => executePowerAction("start")}
                loading={pendingAction === "start"}
                disabled={
                  disableAllButtons || !controls.canStart || startLock.locked
                }
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
                disabled={disableAllButtons || !canRestart || powerLock.locked}
              >
                <RotateCcw className="size-4" />
                {t("servers:managementBar.actions.restart")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => executePowerAction("stop")}
                loading={pendingAction === "stop"}
                disabled={
                  disableAllButtons || !controls.canStop || powerLock.locked
                }
              >
                <Pause className="size-4" />
                {t("servers:managementBar.actions.stop")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => executePowerAction("kill")}
                loading={pendingAction === "kill"}
                disabled={
                  disableAllButtons || !controls.canKill || powerLock.locked
                }
              >
                <ShieldAlert className="size-4" />
                {t("servers:managementBar.actions.kill")}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent
          className={
            usage.swap === "Disabled"
              ? "grid grid-cols-3 gap-4"
              : "grid grid-cols-4 gap-4"
          }
        >
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              {t("common:resources.cpu")}
            </p>
            <p
              className={cn(
                "mt-1 text-sm font-medium",
                cpuHigh && "text-destructive",
              )}
            >
              {usage.cpu}
            </p>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              {t("servers:managementBar.stats.ram")}
            </p>
            <p
              className={cn(
                "mt-1 text-sm font-medium",
                ramHigh && "text-destructive",
              )}
            >
              {usage.ram}
            </p>
          </div>
          {usage.swap !== "Disabled" && (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                {t("servers:managementBar.stats.swap")}
              </p>
              <p className="mt-1 text-sm font-medium">{usage.swap}</p>
            </div>
          )}
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              {t("common:resources.disk")}
            </p>
            <p
              className={cn(
                "mt-1 text-sm font-medium",
                diskHigh && "text-destructive",
              )}
            >
              {usage.disk}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
