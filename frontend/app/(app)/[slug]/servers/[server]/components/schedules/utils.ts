import {
  SchedulePolicy,
  type BackupRetention,
  type ListSchedulesResponse,
  type ScheduleTask,
} from "@/lib/api";
import type { SimpleSchedule } from "@/lib/cron";

export type Schedule = ListSchedulesResponse[number];
export type TaskType = ScheduleTask["type"];
export type RetentionTask = Extract<ScheduleTask, { type: "backup" | "prune" }>;

export type ScheduleBody = {
  name: string;
  enabled: boolean;
  policy: SchedulePolicy;
  cron: string;
  timezone: string;
  tasks: ScheduleTask[];
};

export const TASK_TYPES: TaskType[] = [
  "start",
  "stop",
  "restart",
  "kill",
  "sleep",
  "terminal",
  "container",
  "minecraft",
  "backup",
  "prune",
];

export const RETENTION_FIELDS = [
  "keep_last",
  "keep_hourly",
  "keep_daily",
  "keep_weekly",
  "keep_monthly",
  "keep_yearly",
] as const;

export const EMPTY_RETENTION: BackupRetention = {
  keep_last: 0,
  keep_hourly: 0,
  keep_daily: 0,
  keep_weekly: 0,
  keep_monthly: 0,
  keep_yearly: 0,
};

export const DEFAULT_RETENTION: BackupRetention = {
  ...EMPTY_RETENTION,
  keep_last: 5,
};

export const LISTED_TASKS = 3;

export const DEFAULT_CRON = ["0", "0", "4", "*", "*", "*"];

export const FREQUENCIES: SimpleSchedule["frequency"][] = [
  "hourly",
  "daily",
  "weekly",
  "monthly",
];

export const PREVIEW_RUNS = 3;

export const POLICIES = [
  SchedulePolicy.ALWAYS,
  SchedulePolicy.RUNNING,
  SchedulePolicy.STOPPED,
];

export function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  } catch {
    return "Etc/UTC";
  }
}

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
};

export function timezones(): string[] {
  try {
    const supported = (Intl as IntlWithSupportedValues).supportedValuesOf?.(
      "timeZone",
    );
    if (supported && supported.length > 0) return supported;
  } catch {
    return [localTimezone(), "Etc/UTC"];
  }

  return [localTimezone(), "Etc/UTC"];
}

export function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function pad(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * Renders a run returned by `nextCronRuns`. Its UTC fields carry the wall clock
 * of the schedule's own timezone, so it is formatted as UTC on purpose.
 */
export function formatWallClock(run: Date, language: string) {
  return new Intl.DateTimeFormat(language, {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(run);
}

const SLEEP_HINT_UNITS = [
  { unit: "day", seconds: 86400 },
  { unit: "hour", seconds: 3600 },
  { unit: "minute", seconds: 60 },
] as const;

export function formatSleepHint(seconds: number, language: string) {
  const match = SLEEP_HINT_UNITS.find((entry) => seconds >= entry.seconds);
  if (!match) return null;

  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: match.unit,
    unitDisplay: "long",
    maximumFractionDigits: 1,
  }).format(seconds / match.seconds);
}

/**
 * The most backups a policy can ever keep, mirroring `BackupRetention::max_kept`
 * on the backend: counters are a union, so their sum is the ceiling, and a
 * policy without a single counter keeps everything and has no ceiling at all.
 */
export function retentionCeiling(
  retention: BackupRetention | null | undefined,
) {
  if (!retention) return null;

  const total = RETENTION_FIELDS.reduce(
    (sum, field) => sum + (retention[field] || 0),
    0,
  );

  return total === 0 ? null : total;
}

export function retentionOf(task: RetentionTask) {
  return task.type === "prune" ? task.retention : (task.retention ?? null);
}

export function emptyTask(type: TaskType): ScheduleTask {
  switch (type) {
    case "sleep":
      return { type, time: 60 };
    case "terminal":
    case "minecraft":
      return { type, command: "" };
    case "container":
      return { type, command: [] };
    case "backup":
      return { type, storage: null, retention: null };
    case "prune":
      return { type, storage: null, retention: DEFAULT_RETENTION };
    default:
      return { type } as ScheduleTask;
  }
}

export function taskIsComplete(task: ScheduleTask) {
  if (task.type === "terminal" || task.type === "minecraft") {
    return task.command.trim().length > 0;
  }
  if (task.type === "container") {
    return task.command.some((part) => part.trim().length > 0);
  }
  if (task.type === "prune") {
    return retentionCeiling(task.retention) !== null;
  }

  return true;
}

/**
 * A scheduled backup on a server with a backup limit has to remove as much as
 * it creates, so its policy must keep within that limit. The backend rejects
 * anything else.
 */
export function taskFitsBackupLimit(
  task: ScheduleTask,
  backupLimit: number | null,
) {
  if (backupLimit === null || task.type !== "backup") return true;

  const ceiling = retentionCeiling(task.retention);
  return ceiling !== null && ceiling <= backupLimit;
}
