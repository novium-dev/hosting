"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "@/components/link";
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
import { cn, titleCase } from "@/lib/utils";
import {
  HIGH_USAGE_THRESHOLD,
  buildBaseUsage,
  controlsFromState,
  deriveInitialUsage,
  formatCpuUsage,
  formatUptime,
  formatUsage,
  statusFromLabel,
  statusLabel,
  statusVariant,
  toFiniteNumber,
  usagePercentValue,
  type ControlState,
  type ServerLifecycleState,
  type StatsSnapshot,
  type UsagePercents,
  type UsageState,
} from "@/lib/server-status";

type ServerManagementBarProps = {
  serverId: string;
  serverName: string;
  address: string;
  nodeDisplay: string;
  template: string;
  suspended: boolean;
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

type PowerAction = "start" | "stop" | "restart" | "kill";
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
  const [controls, setControls] = useState<ControlState>(() =>
    controlsFromState(seededStatus),
  );

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

    setUsage(initialUsage.usage);
    setUsagePercents(initialUsage.percents);

    const connectStats = async () => {
      try {
        const statsUrl = await serverStats({ path: { server_id: serverId } });

        if (statsUrl.error) {
          if (mounted) {
            setConnection("disconnected");
            toast.error("Failed to connect to server stats");
          }
          return;
        }

        const socketUrl = statsUrl.data;
        if (!socketUrl) {
          if (mounted) {
            setConnection("disconnected");
            toast.error("Invalid stats websocket URL");
          }
          return;
        }

        socket = new WebSocket(socketUrl);
        socket.binaryType = "arraybuffer";

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
        };

        socket.onclose = () => {
          if (!mounted) {
            return;
          }

          setConnection("disconnected");
        };

        socket.onmessage = (event) => {
          if (!mounted || typeof event.data !== "string") {
            return;
          }

          const message = event.data;

          if (message.startsWith("STATS!")) {
            try {
              const payload = JSON.parse(message.slice(6)) as Record<
                string,
                unknown
              >;

              const ramCurrent = payload.ram ?? payload.mem;
              const ramMax = payload.ram_max ?? payload.mem_max ?? ramLimit;
              const cpuCurrent = payload.cpu ?? payload.cpu_absolute;
              const cpuMax = payload.cpu_max ?? cpuLimit;
              const diskCurrent = payload.disk ?? payload.storage;
              const diskMax =
                payload.disk_max ?? payload.storage_max ?? diskLimit;
              const swapMax = payload.swap_max ?? swapLimit;

              setUsage({
                cpu: formatCpuUsage(cpuCurrent, cpuMax),
                ram: formatUsage(ramCurrent, ramMax, "MiB"),
                disk: formatUsage(diskCurrent, diskMax, "MiB"),
                swap:
                  swapMax === 0
                    ? "Disabled"
                    : formatUsage(payload.swap, swapMax, "MiB"),
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
  }, [initialUsage, cpuLimit, diskLimit, ramLimit, serverId, swapLimit]);

  const executePowerAction = async (action: PowerAction) => {
    setPendingAction(action);

    try {
      switch (action) {
        case "start": {
          const res = await startServer({ path: { server_id: serverId } });

          console.log("Start server response", res);

          if (res.error) {
            throw new Error("Failed to start server: " + res.error.error?.msg);
          }
          break;
        }
        case "stop": {
          const res = await stopServer({ path: { server_id: serverId } });

          if (res.error) {
            throw new Error("Failed to stop server: " + res.error.error?.msg);
          }
          break;
        }
        case "restart": {
          const res = await restartServer({ path: { server_id: serverId } });

          if (res.error) {
            throw new Error(
              "Failed to restart server: " + res.error.error?.msg,
            );
          }
          break;
        }
        case "kill": {
          const res = await killServer({ path: { server_id: serverId } });

          if (res.error) {
            throw new Error("Failed to kill server: " + res.error.error?.msg);
            return;
          }
          break;
        }
      }

      toast.success(`Server ${action} command sent`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "An unknown error occurred";
      toast.error(message);
    } finally {
      setPendingAction(null);
    }
  };

  const canCopyAddress = address !== "Address unavailable";
  const uptimeMs =
    status === "running" && startedAt !== null ? now - startedAt : null;

  const handleCopyAddress = async () => {
    if (!canCopyAddress) {
      return;
    }

    try {
      await navigator.clipboard.writeText(address);
      setAddressCopied(true);
      toast.success("Server address copied");
    } catch {
      toast.error("Failed to copy server address");
    }
  };

  const cpuHigh =
    usagePercents.cpu !== null && usagePercents.cpu >= HIGH_USAGE_THRESHOLD;
  const ramHigh =
    usagePercents.ram !== null && usagePercents.ram >= HIGH_USAGE_THRESHOLD;
  const diskHigh =
    usagePercents.disk !== null && usagePercents.disk >= HIGH_USAGE_THRESHOLD;

  return (
    <div className="space-y-4">
      {(cpuHigh || ramHigh) && (
        <Alert
          variant="destructive"
          className="border-destructive/40 bg-destructive/10"
        >
          <AlertTriangle className="size-4" />
          <AlertTitle>
            {cpuHigh && ramHigh
              ? "CPU and memory usage are high"
              : cpuHigh
                ? "CPU usage is high"
                : "Memory usage is high"}
          </AlertTitle>
          <AlertDescription>
            {cpuHigh && usagePercents.cpu !== null
              ? `CPU is at ${usagePercents.cpu.toFixed(1)}% of its limit. `
              : null}
            {ramHigh && usagePercents.ram !== null
              ? `Memory is at ${usagePercents.ram.toFixed(1)}% of its limit. `
              : null}
            The server may become unresponsive or be killed if it runs out of
            resources.
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
                  title="Copy server address"
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
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Waypoints className="size-4" />
                  {address}
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
                  title="Uptime"
                >
                  <Clock className="size-4" />
                  {formatUptime(uptimeMs)}
                </span>
              )}
              {suspended && <Badge variant="destructive">Suspended</Badge>}
              {nodeMaintenance && (
                <Badge variant="destructive">Node In Maintenance</Badge>
              )}
              {actionsDisabled && disabledReason && (
                <span className="inline-flex items-center gap-1.5 text-destructive">
                  {disabledReason}
                </span>
              )}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {adminHref && (
              <Button asChild size="sm" variant="outline">
                <Link href={adminHref}>
                  <Shield className="mr-2 size-4" />
                  Admin UI
                </Link>
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => executePowerAction("start")}
              loading={pendingAction === "start"}
              disabled={disableAllButtons || !controls.canStart}
            >
              <Play className="size-4" />
              Start
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => executePowerAction("restart")}
              loading={pendingAction === "restart"}
              disabled={disableAllButtons || !canRestart}
            >
              <RotateCcw className="size-4" />
              Restart
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
              Stop
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
              Kill
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
          <p className="text-xs text-muted-foreground">Disk</p>
          <p
            className={cn(
              "mt-1 text-sm font-medium",
              diskHigh && "text-destructive",
            )}
          >
            {usage.disk}
          </p>
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">RAM</p>
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
            <p className="text-xs text-muted-foreground">Swap</p>
            <p className="mt-1 text-sm font-medium">{usage.swap}</p>
          </div>
        )}
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">CPU</p>
          <p
            className={cn(
              "mt-1 text-sm font-medium",
              cpuHigh && "text-destructive",
            )}
          >
            {usage.cpu}
          </p>
        </div>
      </CardContent>
      </Card>
    </div>
  );
}
