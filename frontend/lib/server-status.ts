/**
 * Shared helpers for rendering a server's daemon status and resource usage.
 *
 * Used by both the server management bar (live websocket updates) and the
 * project server list (snapshot from `list_servers?include=true`).
 */

export type ServerLifecycleState =
  | "stopped"
  | "starting"
  | "unhealthy"
  | "running"
  | "stopping"
  | "restarting"
  | "locked"
  | "unknown";

export type UsageState = {
  cpu: string;
  disk: string;
  ram: string;
  swap: string;
};

export type UsagePercents = {
  cpu: number | null;
  ram: number | null;
  disk: number | null;
};

export type ControlState = {
  canStart: boolean;
  canStop: boolean;
  canKill: boolean;
};

/** Resource usage snapshot as returned by the backend (`ServerStats`). */
export type StatsSnapshot = {
  cpu?: number | null;
  cpu_max?: number | null;
  ram?: number | null;
  ram_max?: number | null;
  disk?: number | null;
  disk_max?: number | null;
  swap?: number | null;
  swap_max?: number | null;
};

/** Usage (as a percentage of the limit) at/above which a resource is
 * considered low and highlighted in red / surfaced as an alert. */
export const HIGH_USAGE_THRESHOLD = 80;

/** How long CPU/RAM usage has to stay on one side of {@link HIGH_USAGE_THRESHOLD}
 * before the alert is shown or hidden, so that short spikes (server startup) and
 * values oscillating around the threshold don't flash the alert in and out. */
export const HIGH_USAGE_SUSTAIN_MS = 2000;

export const DEFAULT_USAGE_PERCENTS: UsagePercents = {
  cpu: null,
  ram: null,
  disk: null,
};

export const DEFAULT_USAGE: UsageState = {
  cpu: "--",
  disk: "-- / --",
  ram: "-- / --",
  swap: "-- / --",
};

export function toFiniteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function usagePercentValue(
  current: unknown,
  max: unknown,
): number | null {
  const currentNumber = toFiniteNumber(current);
  const maxNumber = toFiniteNumber(max);
  return currentNumber !== null && maxNumber !== null && maxNumber > 0
    ? (currentNumber / maxNumber) * 100
    : null;
}

function formatBaseUsage(max: number | null) {
  if (max === null) {
    return `-- / Unlimited`;
  }

  if (!Number.isFinite(max) || max < 0) {
    return "-- / --";
  }

  return `-- / ${formatMib(max)}`;
}

function formatCores(value: number) {
  return value.toFixed(2).replace(/\.?0+$/, "") + " Cores";
}

function formatBaseCpuUsage(max: number | null) {
  if (max === null) {
    return "-- / Unlimited";
  }

  if (!Number.isFinite(max) || max < 0) {
    return "--";
  }

  return `-- / ${formatCores(max)}`;
}

export function buildBaseUsage(limits: {
  cpuLimit: number | null;
  diskLimit: number | null;
  ramLimit: number | null;
  swapLimit: number | null;
}): UsageState {
  return {
    cpu: formatBaseCpuUsage(limits.cpuLimit),
    disk: formatBaseUsage(limits.diskLimit),
    ram: formatBaseUsage(limits.ramLimit),
    swap:
      limits.swapLimit === 0 ? "Disabled" : formatBaseUsage(limits.swapLimit),
  };
}

export function formatUsage(current: unknown, max: unknown) {
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

    return `-- / ${formatMib(maxNumber)}`;
  }

  if (!Number.isFinite(currentNumber) || currentNumber < 0) {
    return "Unknown";
  }

  // if current is provided and max is null, show current / Unlimited
  if (max == null || !Number.isFinite(maxNumber) || maxNumber < 0) {
    return `${formatMib(currentNumber)} / Unlimited`;
  }

  return `${formatMib(currentNumber)} / ${formatMib(maxNumber)}`;
}

export function formatCpuUsage(current: unknown, max: unknown) {
  const currentNumber = toFiniteNumber(current);

  if (currentNumber === null) {
    return "--";
  }

  const maxNumber = toFiniteNumber(max);
  if (maxNumber === null || maxNumber === 0) {
    return `${formatCores(currentNumber)} / Unlimited`;
  }

  return `${formatCores(currentNumber)} / ${formatCores(maxNumber)}`;
}

const MIB_SCALES = [
  { min: 1024 * 1024, factor: 1024 * 1024, unit: "TiB" },
  { min: 1024, factor: 1024, unit: "GiB" },
  { min: 0, factor: 1, unit: "MiB" },
];

function mibScale(value: number) {
  return MIB_SCALES.find((scale) => value >= scale.min) ?? MIB_SCALES[2];
}

function formatScaled(value: number) {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatMib(value: number) {
  const scale = mibScale(value);
  return `${formatScaled(value / scale.factor)} ${scale.unit}`;
}

export function formatUsageCompact(current: unknown, max: unknown): string {
  const value = current == null ? null : toFiniteNumber(current);
  const limit = max == null ? null : toFiniteNumber(max);

  if (value === null && limit === null) {
    return "-- / --";
  }

  const scale = mibScale(limit ?? value ?? 0);
  const valueText = value === null ? "--" : formatScaled(value / scale.factor);

  if (limit === null) {
    return `${valueText} ${scale.unit} / ∞`;
  }

  return `${valueText} / ${formatScaled(limit / scale.factor)} ${scale.unit}`;
}

export function formatCpuCompact(current: unknown, max: unknown): string {
  const value = current == null ? null : toFiniteNumber(current);
  const limit = max == null ? null : toFiniteNumber(max);

  if (value === null && limit === null) {
    return "-- / --";
  }

  const valueText = value === null ? "--" : formatCores(value);

  if (limit === null) {
    return `${valueText} / ∞`;
  }

  return `${valueText} / ${formatCores(limit)}`;
}

export function formatCpuCores(current: unknown): string {
  const value = current == null ? null : toFiniteNumber(current);
  return value === null ? "--" : formatCores(value);
}

export function formatUptime(ms: number): string {
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

export function statusFromLabel(label: string): ServerLifecycleState {
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

export function statusLabel(status: ServerLifecycleState) {
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

export function statusVariant(
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

/** Tailwind classes for the status dot / text of a lifecycle state. */
export function statusTone(status: ServerLifecycleState): {
  dot: string;
  text: string;
  accent: string;
} {
  switch (status) {
    case "running":
      return {
        dot: "bg-emerald-500",
        text: "text-emerald-600 dark:text-emerald-400",
        accent: "bg-emerald-500",
      };
    case "unhealthy":
      return {
        dot: "bg-red-500",
        text: "text-red-600 dark:text-red-400",
        accent: "bg-red-500",
      };
    case "starting":
    case "stopping":
    case "restarting":
      return {
        dot: "bg-amber-500",
        text: "text-amber-600 dark:text-amber-400",
        accent: "bg-amber-500",
      };
    case "stopped":
    case "locked":
      return {
        dot: "bg-muted-foreground/50",
        text: "text-muted-foreground",
        accent: "bg-muted-foreground/40",
      };
    default:
      return {
        dot: "bg-muted-foreground/40",
        text: "text-muted-foreground",
        accent: "bg-muted-foreground/30",
      };
  }
}

/**
 * Derives the usage display + percentages from a stats snapshot, falling back
 * to the limit-only base usage when no snapshot is available.
 */
export function deriveInitialUsage(
  stats: StatsSnapshot | null | undefined,
  limits: {
    cpuLimit: number | null;
    diskLimit: number | null;
    ramLimit: number | null;
    swapLimit: number | null;
  },
  baseUsage: UsageState,
): { usage: UsageState; percents: UsagePercents } {
  if (!stats) {
    return { usage: baseUsage, percents: DEFAULT_USAGE_PERCENTS };
  }

  const cpuMax = stats.cpu_max ?? limits.cpuLimit;
  const ramMax = stats.ram_max ?? limits.ramLimit;
  const diskMax = stats.disk_max ?? limits.diskLimit;
  const swapMax = stats.swap_max ?? limits.swapLimit;

  return {
    usage: {
      cpu: formatCpuUsage(stats.cpu, cpuMax),
      ram: formatUsage(stats.ram, ramMax),
      disk: formatUsage(stats.disk, diskMax),
      swap: swapMax === 0 ? "Disabled" : formatUsage(stats.swap, swapMax),
    },
    percents: {
      cpu: usagePercentValue(stats.cpu, cpuMax),
      ram: usagePercentValue(stats.ram, ramMax),
      disk: usagePercentValue(stats.disk, diskMax),
    },
  };
}

/**
 * Whether a wipe may be started in this state. The backend refuses a wipe of a
 * running server, so anything but a stopped server is blocked; an unknown state
 * (no status seeded and no websocket yet) is left to the backend to decide.
 */
export function allowsWipe(status: ServerLifecycleState): boolean {
  return status === "stopped" || status === "unknown";
}

/**
 * Best-effort control availability derived from the lifecycle state, used
 * before the websocket delivers authoritative flags.
 */
export function controlsFromState(state: ServerLifecycleState): ControlState {
  switch (state) {
    case "running":
    case "unhealthy":
    case "starting":
    case "restarting":
      return { canStart: false, canStop: true, canKill: true };
    case "stopping":
      return { canStart: false, canStop: false, canKill: true };
    default:
      return { canStart: true, canStop: false, canKill: false };
  }
}
