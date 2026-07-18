"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "@/components/link";
import {
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
import { titleCase } from "@/lib/utils";

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
};

type PowerAction = "start" | "stop" | "restart" | "kill";
type ServerLifecycleState =
  | "stopped"
  | "starting"
  | "unhealthy"
  | "running"
  | "stopping"
  | "restarting"
  | "locked"
  | "unknown";
type StatsConnection = "connecting" | "connected" | "disconnected";

type UsageState = {
  cpu: string;
  disk: string;
  ram: string;
  swap: string;
};

export const DISK_USAGE_EVENT = "server-disk-usage";

export type DiskUsageEventDetail = {
  serverId: string;
  percent: number | null;
};

type ControlState = {
  canStart: boolean;
  canStop: boolean;
  canKill: boolean;
};

const DEFAULT_USAGE: UsageState = {
  cpu: "--",
  disk: "-- / --",
  ram: "-- / --",
  swap: "-- / --",
};

function formatBaseUsage(max: number | null, unit: string) {
  if (max === null) {
    return `-- / Unlimited`;
  }

  if (!Number.isFinite(max) || max < 0) {
    return "-- / --";
  }

  const convertedMax = max.toFixed(2);
  return `-- / ${convertedMax} ${unit}`;
}

function formatBaseCpuUsage(max: number | null) {
  if (max === null) {
    return "-- / Unlimited";
  }

  if (!Number.isFinite(max) || max < 0) {
    return "--";
  }

  return `-- / ${max.toFixed(2)}%`;
}

function buildBaseUsage(limits: {
  cpuLimit: number | null;
  diskLimit: number | null;
  ramLimit: number | null;
  swapLimit: number | null;
}): UsageState {
  return {
    cpu: formatBaseCpuUsage(limits.cpuLimit),
    disk: formatBaseUsage(limits.diskLimit, "MiB"),
    ram: formatBaseUsage(limits.ramLimit, "MiB"),
    swap:
      limits.swapLimit === 0
        ? "Disabled"
        : formatBaseUsage(limits.swapLimit, "MiB"),
  };
}

function statusVariant(
  status: ServerLifecycleState,
): "default" | "secondary" | "outline" {
  if (status === "running") {
    return "default";
  }

  if (status === "stopped" || status === "locked") {
    return "secondary";
  }

  return "outline";
}

function statusLabel(status: ServerLifecycleState) {
  switch (status) {
    case "stopped":
      return "Stopped";
    case "starting":
      return "Starting";
    case "unhealthy":
      return "Unhealthy";
    case "running":
      return "Running";
    case "stopping":
      return "Stopping";
    case "restarting":
      return "Restarting";
    case "locked":
      return "Locked";
    default:
      return "Unknown";
  }
}

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

function formatUsage(current: unknown, max: unknown, unit: string) {
  const currentNumber = Number(current);
  const maxNumber = Number(max);

  if (current == null && max == null) {
    return "-- / --";
  }

  // if current null and max is provided, show -- / max
  if (current == null && max != null) {
    if (!Number.isFinite(maxNumber) || maxNumber < 0) {
      return "-- / --";
    }

    const convertedMax = maxNumber.toFixed(2);
    return `-- / ${convertedMax} ${unit}`;
  }

  // if current is provided and max is null, show current / Unlimited
  if (current != null && max == null) {
    if (!Number.isFinite(currentNumber) || currentNumber < 0) {
      return "Unknown";
    }

    const convertedCurrent = currentNumber.toFixed(2);
    return `${convertedCurrent} ${unit} / Unlimited`;
  }

  if (!Number.isFinite(currentNumber) || currentNumber < 0) {
    return "Unknown";
  }

  const convertedCurrent = currentNumber.toFixed(2);

  if (!Number.isFinite(maxNumber) || maxNumber < 0) {
    return `${convertedCurrent} ${unit} / Unlimited`;
  }

  const convertedMax = maxNumber.toFixed(2);

  return `${convertedCurrent} ${unit} / ${convertedMax} ${unit}`;
}

function toFiniteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function formatUptime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "--";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  if (days > 0 || hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

function formatCpuUsage(current: unknown, max: unknown) {
  const currentNumber = toFiniteNumber(current);

  if (currentNumber === null) {
    return "--";
  }

  const maxNumber = toFiniteNumber(max);
  if (maxNumber === null || maxNumber === 0) {
    return `${currentNumber.toFixed(2)}%`;
  }

  return `${currentNumber.toFixed(2)}% / ${maxNumber.toFixed(2)}%`;
}

function statusFromLabel(label: string): ServerLifecycleState {
  const normalized = label.trim().toLowerCase();

  if (normalized.includes("locked")) {
    return "locked";
  }

  if (normalized.includes("unhealthy")) {
    return "unhealthy";
  }

  if (normalized.includes("restarting")) {
    return "restarting";
  }

  if (normalized.includes("starting")) {
    return "starting";
  }

  if (normalized.includes("stopping")) {
    return "stopping";
  }

  if (["running", "online"].includes(normalized)) {
    return "running";
  }

  if (["stopped", "offline", "crashed"].includes(normalized)) {
    return "stopped";
  }

  return "unknown";
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
}: ServerManagementBarProps) {
  const baseUsage = useMemo(
    () => buildBaseUsage({ cpuLimit, diskLimit, ramLimit, swapLimit }),
    [cpuLimit, diskLimit, ramLimit, swapLimit],
  );

  const [status, setStatus] = useState<ServerLifecycleState>("unknown");
  const [usage, setUsage] = useState<UsageState>(baseUsage);
  const [connection, setConnection] = useState<StatsConnection>("connecting");
  const [pendingAction, setPendingAction] = useState<PowerAction | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [controls, setControls] = useState<ControlState>({
    canStart: true,
    canStop: false,
    canKill: false,
  });

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
    setUsage(baseUsage);
  }, [baseUsage]);

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

    setUsage(baseUsage);

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

              const diskCurrentNumber = toFiniteNumber(diskCurrent);
              const diskMaxNumber = toFiniteNumber(diskMax);
              const diskPercent =
                diskCurrentNumber !== null &&
                diskMaxNumber !== null &&
                diskMaxNumber > 0
                  ? (diskCurrentNumber / diskMaxNumber) * 100
                  : null;

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
  }, [baseUsage, cpuLimit, diskLimit, ramLimit, serverId, swapLimit]);

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

  return (
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
          <p className="mt-1 text-sm font-medium">{usage.disk}</p>
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">RAM</p>
          <p className="mt-1 text-sm font-medium">{usage.ram}</p>
        </div>
        {usage.swap !== "Disabled" && (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Swap</p>
            <p className="mt-1 text-sm font-medium">{usage.swap}</p>
          </div>
        )}
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">CPU</p>
          <p className="mt-1 text-sm font-medium">{usage.cpu}</p>
        </div>
      </CardContent>
    </Card>
  );
}
