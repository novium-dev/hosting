"use client";

import type { DragEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  CalendarClock,
  GripVertical,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  runSchedule,
  updateSchedule,
  SchedulePolicy,
  type BackupRetention,
  type ListSchedulesResponse,
  type ScheduleTask,
} from "@/lib/api";
import {
  CRON_FIELDS,
  WEEKDAYS,
  buildCron,
  cronFields,
  nextCronRuns,
  parseCron,
  parseCronField,
  toSimpleSchedule,
  type SimpleSchedule,
} from "@/lib/cron";
import { apiErrorMessage } from "@/lib/api-error";

type SchedulesManagerProps = {
  serverId: string;
  canManage: boolean;
  canUseContainerCommands: boolean;
  canCreateBackups: boolean;
  canDeleteBackups: boolean;
  backupLimit: number | null;
  isMinecraftServer: boolean;
};

type RetentionTask = Extract<ScheduleTask, { type: "backup" | "prune" }>;

type Schedule = ListSchedulesResponse[number];
type TaskType = ScheduleTask["type"];

const TASK_TYPES: TaskType[] = [
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

const RETENTION_FIELDS = [
  "keep_last",
  "keep_hourly",
  "keep_daily",
  "keep_weekly",
  "keep_monthly",
  "keep_yearly",
] as const;

const EMPTY_RETENTION: BackupRetention = {
  keep_last: 0,
  keep_hourly: 0,
  keep_daily: 0,
  keep_weekly: 0,
  keep_monthly: 0,
  keep_yearly: 0,
};

const DEFAULT_RETENTION: BackupRetention = { ...EMPTY_RETENTION, keep_last: 5 };

/** How many steps the table lists before the rest are folded into a tooltip. */
const LISTED_TASKS = 3;

const DEFAULT_CRON = ["0", "0", "4", "*", "*", "*"];

const FREQUENCIES: SimpleSchedule["frequency"][] = [
  "hourly",
  "daily",
  "weekly",
  "monthly",
];

const PREVIEW_RUNS = 3;

const POLICIES = [
  SchedulePolicy.ALWAYS,
  SchedulePolicy.RUNNING,
  SchedulePolicy.STOPPED,
];

function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  } catch {
    return "Etc/UTC";
  }
}

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
};

function timezones(): string[] {
  try {
    const supported = (Intl as IntlWithSupportedValues).supportedValuesOf?.(
      "timeZone",
    );
    if (supported && supported.length > 0) return supported;
  } catch {
    /* falls through to the local zone below */
  }

  return [localTimezone(), "Etc/UTC"];
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * Renders a run returned by `nextCronRuns`. Its UTC fields carry the wall clock
 * of the schedule's own timezone, so it is formatted as UTC on purpose.
 */
function formatWallClock(run: Date, language: string) {
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

function formatSleepHint(seconds: number, language: string) {
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
function retentionCeiling(retention: BackupRetention | null | undefined) {
  if (!retention) return null;

  const total = RETENTION_FIELDS.reduce(
    (sum, field) => sum + (retention[field] || 0),
    0,
  );

  return total === 0 ? null : total;
}

function retentionOf(task: RetentionTask) {
  return task.type === "prune" ? task.retention : (task.retention ?? null);
}

function RetentionTaskField({
  task,
  backupLimit,
  canDeleteBackups,
  onChange,
}: {
  task: RetentionTask;
  backupLimit: number | null;
  canDeleteBackups: boolean;
  onChange: (task: RetentionTask) => void;
}) {
  const { t } = useTranslation();
  const retention = retentionOf(task);
  const ceiling = retentionCeiling(retention);
  const overLimit =
    task.type === "backup" &&
    backupLimit !== null &&
    (ceiling === null || ceiling > backupLimit);

  const setRetention = (next: BackupRetention | null) => {
    onChange(
      task.type === "prune"
        ? { ...task, retention: next ?? EMPTY_RETENTION }
        : { ...task, retention: next },
    );
  };

  const summary = retention
    ? RETENTION_FIELDS.filter((field) => (retention[field] || 0) > 0)
        .map(
          (field) =>
            `${retention[field]} ${t(`servers:schedules.retention.fields.${field}`)}`,
        )
        .join(" · ")
    : "";

  return (
    <div className="flex w-full min-w-0 items-center gap-2 sm:flex-1">
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className="min-w-0 flex-1 justify-start font-normal"
            />
          }
        >
          <Archive className="size-4 shrink-0" />
          <span className="truncate">
            {summary.length > 0
              ? summary
              : t("servers:schedules.retention.keepEverything")}
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-88 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {t("servers:schedules.retention.title")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("servers:schedules.retention.description")}
            </p>
          </div>

          {task.type === "backup" ? (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={`retention-${task.type}`} className="text-sm">
                {t("servers:schedules.retention.enable")}
              </Label>
              <Switch
                id={`retention-${task.type}`}
                checked={retention !== null}
                disabled={!canDeleteBackups}
                onCheckedChange={(checked) =>
                  setRetention(checked ? DEFAULT_RETENTION : null)
                }
              />
            </div>
          ) : null}

          {retention ? (
            <div className="grid grid-cols-2 gap-2">
              {RETENTION_FIELDS.map((field) => (
                <div key={field} className="space-y-1">
                  <Label
                    htmlFor={`${field}-${task.type}`}
                    className="text-xs text-muted-foreground"
                  >
                    {t(`servers:schedules.retention.fields.${field}`)}
                  </Label>
                  <Input
                    id={`${field}-${task.type}`}
                    type="number"
                    min={0}
                    className="h-8 tabular-nums"
                    value={retention[field]}
                    onChange={(event) =>
                      setRetention({
                        ...retention,
                        [field]: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}

          {backupLimit === null ? null : (
            <p className="text-xs text-muted-foreground">
              {t("servers:schedules.retention.limitHint", {
                limit: backupLimit,
              })}
            </p>
          )}
        </PopoverContent>
      </Popover>

      {overLimit ? (
        <span className="shrink-0 text-xs text-destructive">
          {t("servers:schedules.retention.limitExceeded")}
        </span>
      ) : null}
    </div>
  );
}

function ScheduleTaskSummary({ tasks }: { tasks: ScheduleTask[] }) {
  const { t } = useTranslation();

  const labels = tasks.map((task) =>
    t(`servers:schedules.taskTypes.${task.type}`),
  );
  const listed = labels.slice(0, LISTED_TASKS).join(" → ");
  const hidden = labels.length - LISTED_TASKS;

  if (hidden <= 0) {
    return <span>{listed}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="cursor-default underline decoration-dotted underline-offset-4" />
        }
      >
        {listed} → {t("servers:schedules.table.moreTasks", { count: hidden })}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{labels.join(" → ")}</TooltipContent>
    </Tooltip>
  );
}

function SleepTaskField({
  value,
  onChange,
}: {
  value: number;
  onChange: (seconds: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const hint = formatSleepHint(value, i18n.language);

  return (
    <div className="flex w-full items-center gap-3 sm:flex-1">
      <div className="relative w-full sm:w-48">
        <Input
          type="number"
          min={1}
          className="w-full pr-24 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          value={value}
          aria-label={t("servers:schedules.dialog.sleepSeconds")}
          onChange={(event) =>
            onChange(Math.max(1, Number(event.target.value) || 1))
          }
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
          {t("servers:schedules.dialog.sleepUnit", { count: value })}
        </span>
      </div>
      {hint ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          {t("servers:schedules.dialog.sleepHint", { duration: hint })}
        </span>
      ) : null}
    </div>
  );
}

function emptyTask(type: TaskType): ScheduleTask {
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

function taskIsComplete(task: ScheduleTask) {
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
function taskFitsBackupLimit(task: ScheduleTask, backupLimit: number | null) {
  if (backupLimit === null || task.type !== "backup") return true;

  const ceiling = retentionCeiling(task.retention);
  return ceiling !== null && ceiling <= backupLimit;
}

export function SchedulesManager({
  serverId,
  canManage,
  canUseContainerCommands,
  canCreateBackups,
  canDeleteBackups,
  backupLimit,
  isMinecraftServer,
}: SchedulesManagerProps) {
  const { t, i18n } = useTranslation();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Schedule | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [policy, setPolicy] = useState<SchedulePolicy>(SchedulePolicy.ALWAYS);
  const [cron, setCron] = useState<string[]>(DEFAULT_CRON);
  const [cronMode, setCronMode] = useState<"simple" | "advanced">("simple");
  const [timezone, setTimezone] = useState(localTimezone());
  const [tasks, setTasks] = useState<ScheduleTask[]>([{ type: "restart" }]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [draggableIndex, setDraggableIndex] = useState<number | null>(null);

  const zones = useMemo(timezones, []);
  const isTaskTypeAvailable = useCallback(
    (type: TaskType) => {
      if (type === "minecraft") return isMinecraftServer;
      if (type === "container") return canUseContainerCommands;
      if (type === "backup") return canCreateBackups;
      if (type === "prune") return canDeleteBackups;
      return true;
    },
    [
      canCreateBackups,
      canDeleteBackups,
      canUseContainerCommands,
      isMinecraftServer,
    ],
  );

  const taskTypesFor = useCallback(
    (current: TaskType) =>
      TASK_TYPES.filter(
        (type) => type === current || isTaskTypeAvailable(type),
      ),
    [isTaskTypeAvailable],
  );

  const refresh = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await listSchedules({ path: { server_id: serverId } });

      if (response.error || !response.data) {
        throw new Error(
          apiErrorMessage(
            response.error,
            t("servers:schedules.toasts.loadFailed"),
          ),
        );
      }

      setSchedules(response.data);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("servers:schedules.toasts.loadFailed"),
      );
    } finally {
      setIsLoading(false);
    }
  }, [serverId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const formatNextRun = useCallback(
    (value: string | null | undefined) => {
      if (!value) return "—";

      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return "—";

      return parsed.toLocaleString(i18n.language);
    },
    [i18n.language],
  );

  const openCreate = () => {
    setEditing(null);
    setName("");
    setEnabled(true);
    setPolicy(SchedulePolicy.ALWAYS);
    setCron(DEFAULT_CRON);
    setCronMode("simple");
    setTimezone(localTimezone());
    setTasks([{ type: "restart" }]);
    setEditorOpen(true);
  };

  const openEdit = (schedule: Schedule) => {
    setEditing(schedule);
    setName(schedule.name);
    setEnabled(schedule.enabled);
    setPolicy(schedule.policy);
    setCron(cronFields(schedule.cron));
    setCronMode(toSimpleSchedule(schedule.cron) ? "simple" : "advanced");
    setTimezone(schedule.timezone);
    setTasks(
      schedule.tasks.length > 0 ? schedule.tasks : [{ type: "restart" }],
    );
    setEditorOpen(true);
  };

  const setCronField = (index: number, value: string) => {
    setCron((current) =>
      current.map((field, position) => (position === index ? value : field)),
    );
  };

  const expression = cron.map((field) => field.trim()).join(" ");
  const simple = useMemo(() => toSimpleSchedule(expression), [expression]);
  const invalidFields = useMemo(
    () =>
      CRON_FIELDS.map(
        (spec, index) => parseCronField(cron[index] ?? "", spec) === null,
      ),
    [cron],
  );
  const preview = useMemo(
    () => nextCronRuns(expression, timezone, PREVIEW_RUNS),
    [expression, timezone],
  );

  const applySimple = (next: SimpleSchedule) => {
    setCron(cronFields(buildCron(next)));
  };

  const simpleOr = (fallback: SimpleSchedule): SimpleSchedule =>
    simple ?? fallback;

  const setTask = (index: number, task: ScheduleTask) => {
    setTasks((current) =>
      current.map((entry, position) => (position === index ? task : entry)),
    );
  };

  const moveTask = (from: number, to: number) => {
    setTasks((current) => {
      if (to < 0 || to >= current.length || from === to) return current;

      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);

      return next;
    });
  };

  const endDrag = () => {
    setDragIndex(null);
    setDropIndex(null);
    setDraggableIndex(null);
  };

  const handleDragStart = (event: DragEvent<HTMLElement>, index: number) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    setDragIndex(index);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>, index: number) => {
    if (dragIndex === null) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropIndex(index);
  };

  const handleDrop = (event: DragEvent<HTMLElement>, index: number) => {
    if (dragIndex === null) return;

    event.preventDefault();
    moveTask(dragIndex, index);
    endDrag();
  };

  const nameValid = name.trim().length > 0 && name.trim().length <= 64;
  const cronValid = parseCron(expression) !== null;
  const tasksValid =
    tasks.length > 0 &&
    tasks.every(
      (task) => taskIsComplete(task) && taskFitsBackupLimit(task, backupLimit),
    );
  const canSubmit = nameValid && cronValid && tasksValid && timezone.length > 0;

  const submit = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);

    const body = {
      name: name.trim(),
      enabled,
      policy,
      cron: cron.map((field) => field.trim()).join(" "),
      timezone,
      tasks,
    };

    try {
      const response = editing
        ? await updateSchedule({
            path: { server_id: serverId, schedule_id: editing.id },
            body,
          })
        : await createSchedule({ path: { server_id: serverId }, body });

      if (response.error) {
        throw new Error(
          apiErrorMessage(
            response.error,
            t("servers:schedules.toasts.saveFailed"),
          ),
        );
      }

      toast.success(
        editing
          ? t("servers:schedules.toasts.updateSuccess")
          : t("servers:schedules.toasts.createSuccess"),
      );
      setEditorOpen(false);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("servers:schedules.toasts.saveFailed"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const runNow = async (schedule: Schedule) => {
    setRunningId(schedule.id);

    try {
      const response = await runSchedule({
        path: { server_id: serverId, schedule_id: schedule.id },
      });

      if (response.error) {
        throw new Error(
          apiErrorMessage(
            response.error,
            t("servers:schedules.toasts.runFailed"),
          ),
        );
      }

      toast.success(
        t("servers:schedules.toasts.runStarted", { name: schedule.name }),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("servers:schedules.toasts.runFailed"),
      );
    } finally {
      setRunningId(null);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;

    setIsSubmitting(true);

    try {
      const response = await deleteSchedule({
        path: { server_id: serverId, schedule_id: pendingDelete.id },
      });

      if (response.error) {
        throw new Error(
          apiErrorMessage(
            response.error,
            t("servers:schedules.toasts.deleteFailed"),
          ),
        );
      }

      toast.success(t("servers:schedules.toasts.deleteSuccess"));
      setPendingDelete(null);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("servers:schedules.toasts.deleteFailed"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <CardTitle>{t("servers:schedules.title")}</CardTitle>
              <CardDescription>
                {t("servers:schedules.description")}
              </CardDescription>
            </div>
            {canManage ? (
              <Button type="button" onClick={openCreate} disabled={isLoading}>
                <Plus className="size-4" />
                {t("servers:schedules.newScheduleButton")}
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : schedules.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("servers:schedules.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common:labels.name")}</TableHead>
                    <TableHead>{t("servers:schedules.table.cron")}</TableHead>
                    <TableHead>{t("servers:schedules.table.policy")}</TableHead>
                    <TableHead>{t("servers:schedules.table.tasks")}</TableHead>
                    <TableHead>
                      {t("servers:schedules.table.nextRun")}
                    </TableHead>
                    <TableHead>{t("common:labels.status")}</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map((schedule) => (
                    <TableRow key={schedule.id}>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          <CalendarClock className="size-4 text-muted-foreground" />
                          {schedule.name}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <div>{schedule.cron}</div>
                        <div className="text-muted-foreground">
                          {schedule.timezone}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {t(`servers:schedules.policies.${schedule.policy}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <ScheduleTaskSummary tasks={schedule.tasks} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {schedule.enabled
                          ? formatNextRun(schedule.next_run)
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            !schedule.enabled
                              ? "secondary"
                              : schedule.synchronized
                                ? "default"
                                : "destructive"
                          }
                        >
                          {!schedule.enabled
                            ? t("common:status.disabled")
                            : schedule.synchronized
                              ? t("common:status.enabled")
                              : t("servers:schedules.outOfSync")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {canManage ? (
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              disabled={
                                !schedule.synchronized || runningId !== null
                              }
                              title={
                                schedule.synchronized
                                  ? t("servers:schedules.runNow")
                                  : t("servers:schedules.runUnavailable")
                              }
                              aria-label={t("servers:schedules.runNow")}
                              onClick={() => void runNow(schedule)}
                            >
                              {runningId === schedule.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Play className="size-4" />
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(schedule)}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => setPendingDelete(schedule)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t("servers:schedules.dialog.editTitle")
                : t("servers:schedules.dialog.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("servers:schedules.dialog.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="schedule-name">{t("common:labels.name")}</Label>
              <Input
                id="schedule-name"
                value={name}
                maxLength={64}
                placeholder={t("servers:schedules.dialog.namePlaceholder")}
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("servers:schedules.dialog.cronLabel")}</Label>
              <Tabs
                value={cronMode}
                onValueChange={(value) =>
                  setCronMode(value === "advanced" ? "advanced" : "simple")
                }
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="simple">
                    {t("servers:schedules.dialog.modeSimple")}
                  </TabsTrigger>
                  <TabsTrigger value="advanced">
                    {t("servers:schedules.dialog.modeAdvanced")}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="simple" className="space-y-3 pt-3">
                  {simple ? (
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          {t("servers:schedules.dialog.frequency")}
                        </Label>
                        <Select
                          items={[
                            ...FREQUENCIES.map((frequency) => ({
                              value: frequency,
                              label: t(
                                `servers:schedules.frequencies.${frequency}`,
                              ),
                            })),
                          ]}
                          value={simple.frequency}
                          onValueChange={(value) => {
                            const frequency =
                              value as SimpleSchedule["frequency"];
                            const hour = "hour" in simple ? simple.hour : 4;

                            applySimple(
                              frequency === "hourly"
                                ? { frequency, minute: simple.minute }
                                : frequency === "daily"
                                  ? { frequency, hour, minute: simple.minute }
                                  : frequency === "weekly"
                                    ? {
                                        frequency,
                                        weekday:
                                          "weekday" in simple
                                            ? simple.weekday
                                            : 2,
                                        hour,
                                        minute: simple.minute,
                                      }
                                    : {
                                        frequency,
                                        dayOfMonth:
                                          "dayOfMonth" in simple
                                            ? simple.dayOfMonth
                                            : 1,
                                        hour,
                                        minute: simple.minute,
                                      },
                            );
                          }}
                        >
                          <SelectTrigger className="w-[180px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FREQUENCIES.map((frequency) => (
                              <SelectItem key={frequency} value={frequency}>
                                {t(
                                  `servers:schedules.frequencies.${frequency}`,
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {simple.frequency === "weekly" ? (
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            {t("servers:schedules.cronFields.dayOfWeek")}
                          </Label>
                          <Select
                            items={[
                              ...WEEKDAYS.map((weekday) => ({
                                value: String(weekday.ordinal),
                                label: t(
                                  `servers:schedules.weekdays.${weekday.key}`,
                                ),
                              })),
                            ]}
                            value={String(simple.weekday)}
                            onValueChange={(value) =>
                              applySimple({ ...simple, weekday: Number(value) })
                            }
                          >
                            <SelectTrigger className="w-[150px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {WEEKDAYS.map((weekday) => (
                                <SelectItem
                                  key={weekday.ordinal}
                                  value={String(weekday.ordinal)}
                                >
                                  {t(
                                    `servers:schedules.weekdays.${weekday.key}`,
                                  )}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}

                      {simple.frequency === "monthly" ? (
                        <div className="space-y-1">
                          <Label
                            htmlFor="schedule-day-of-month"
                            className="text-xs text-muted-foreground"
                          >
                            {t("servers:schedules.cronFields.dayOfMonth")}
                          </Label>
                          <Input
                            id="schedule-day-of-month"
                            type="number"
                            min={1}
                            max={31}
                            className="w-[110px]"
                            value={simple.dayOfMonth}
                            onChange={(event) =>
                              applySimple({
                                ...simple,
                                dayOfMonth: clamp(
                                  Number(event.target.value),
                                  1,
                                  31,
                                ),
                              })
                            }
                          />
                        </div>
                      ) : null}

                      <div className="space-y-1">
                        <Label
                          htmlFor="schedule-time"
                          className="text-xs text-muted-foreground"
                        >
                          {simple.frequency === "hourly"
                            ? t("servers:schedules.cronFields.minute")
                            : t("servers:schedules.dialog.time")}
                        </Label>
                        {simple.frequency === "hourly" ? (
                          <Input
                            id="schedule-time"
                            type="number"
                            min={0}
                            max={59}
                            className="w-[110px]"
                            value={simple.minute}
                            onChange={(event) =>
                              applySimple({
                                ...simple,
                                minute: clamp(
                                  Number(event.target.value),
                                  0,
                                  59,
                                ),
                              })
                            }
                          />
                        ) : (
                          <Input
                            id="schedule-time"
                            type="time"
                            className="w-[140px]"
                            value={`${pad(simple.hour)}:${pad(simple.minute)}`}
                            onChange={(event) => {
                              const [hour, minute] = event.target.value
                                .split(":")
                                .map(Number);
                              if (Number.isNaN(hour) || Number.isNaN(minute)) {
                                return;
                              }

                              applySimple({ ...simple, hour, minute });
                            }}
                          />
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                      {t("servers:schedules.dialog.tooComplexForSimple")}
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="advanced" className="space-y-2 pt-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                    {CRON_FIELDS.map((spec, index) => (
                      <div key={spec.key} className="space-y-1">
                        <Label
                          htmlFor={`schedule-cron-${spec.key}`}
                          className="text-xs text-muted-foreground"
                        >
                          {t(`servers:schedules.cronFields.${spec.key}`)}
                        </Label>
                        <Input
                          id={`schedule-cron-${spec.key}`}
                          className={`font-mono ${
                            invalidFields[index]
                              ? "border-destructive focus-visible:ring-destructive"
                              : ""
                          }`}
                          value={cron[index] ?? "*"}
                          autoComplete="off"
                          aria-invalid={invalidFields[index]}
                          onChange={(event) =>
                            setCronField(index, event.target.value)
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("servers:schedules.dialog.cronHelp")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("servers:schedules.dialog.weekdayHelp")}
                  </p>
                </TabsContent>
              </Tabs>

              <div className="rounded-md border p-3">
                <p className="text-xs font-medium">
                  {t("servers:schedules.dialog.preview")}
                </p>
                {preview.length === 0 ? (
                  <p className="mt-1 text-xs text-destructive">
                    {t("servers:schedules.dialog.previewNone")}
                  </p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {preview.map((run) => (
                      <li
                        key={run.toISOString()}
                        className="text-xs text-muted-foreground"
                      >
                        {formatWallClock(run, i18n.language)}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {expression} · {timezone}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="schedule-timezone">
                  {t("servers:schedules.dialog.timezone")}
                </Label>
                <Select
                  value={timezone}
                  onValueChange={(value) => setTimezone(value ?? "")}
                >
                  <SelectTrigger id="schedule-timezone" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {zones.map((zone) => (
                      <SelectItem key={zone} value={zone}>
                        {zone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="schedule-policy">
                  {t("servers:schedules.dialog.policy")}
                </Label>
                <Select
                  items={[
                    ...POLICIES.map((entry) => ({
                      value: entry,
                      label: t(`servers:schedules.policies.${entry}`),
                    })),
                  ]}
                  value={policy}
                  onValueChange={(value) => setPolicy(value as SchedulePolicy)}
                >
                  <SelectTrigger id="schedule-policy" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POLICIES.map((entry) => (
                      <SelectItem key={entry} value={entry}>
                        {t(`servers:schedules.policies.${entry}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t(`servers:schedules.policyHelp.${policy}`)}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="schedule-enabled">
                  {t("common:status.enabled")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("servers:schedules.dialog.enabledHelp")}
                </p>
              </div>
              <Switch
                id="schedule-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label>{t("servers:schedules.dialog.tasksLabel")}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setTasks((current) => [...current, emptyTask("restart")])
                  }
                >
                  <Plus className="size-4" />
                  {t("servers:schedules.dialog.addTask")}
                </Button>
              </div>

              <div className="space-y-2">
                {tasks.map((task, index) => (
                  <div
                    key={`${task.type}-${index}`}
                    draggable={draggableIndex === index}
                    onDragStart={(event) => handleDragStart(event, index)}
                    onDragOver={(event) => handleDragOver(event, index)}
                    onDrop={(event) => handleDrop(event, index)}
                    onDragEnd={endDrag}
                    className={`flex flex-col gap-2 rounded-md border p-3 transition-colors sm:flex-row sm:items-center ${
                      dragIndex === index ? "opacity-50" : ""
                    } ${
                      dropIndex === index && dragIndex !== index
                        ? "border-primary"
                        : ""
                    }`}
                  >
                    <button
                      type="button"
                      aria-label={t("servers:schedules.dialog.reorder", {
                        position: index + 1,
                        total: tasks.length,
                      })}
                      className="cursor-grab self-start text-muted-foreground hover:text-foreground active:cursor-grabbing sm:self-auto"
                      onMouseDown={() => setDraggableIndex(index)}
                      onMouseUp={() => setDraggableIndex(null)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          moveTask(index, index - 1);
                        }
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          moveTask(index, index + 1);
                        }
                      }}
                    >
                      <GripVertical className="size-4" />
                    </button>

                    <Select
                      items={[
                        ...taskTypesFor(task.type).map((type) => ({
                          value: type,
                          label: t(`servers:schedules.taskTypes.${type}`),
                        })),
                      ]}
                      value={task.type}
                      onValueChange={(value) =>
                        setTask(index, emptyTask(value as TaskType))
                      }
                    >
                      <SelectTrigger className="w-full sm:w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {taskTypesFor(task.type).map((type) => (
                          <SelectItem key={type} value={type}>
                            {t(`servers:schedules.taskTypes.${type}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {task.type === "sleep" ? (
                      <SleepTaskField
                        value={task.time}
                        onChange={(time) =>
                          setTask(index, { type: "sleep", time })
                        }
                      />
                    ) : task.type === "terminal" ||
                      task.type === "minecraft" ? (
                      <Input
                        className="w-full font-mono sm:flex-1"
                        value={task.command}
                        placeholder={t(
                          `servers:schedules.dialog.${task.type}Placeholder`,
                        )}
                        autoComplete="off"
                        onChange={(event) =>
                          setTask(index, {
                            type: task.type,
                            command: event.target.value,
                          })
                        }
                      />
                    ) : task.type === "backup" || task.type === "prune" ? (
                      <RetentionTaskField
                        task={task}
                        backupLimit={backupLimit}
                        canDeleteBackups={canDeleteBackups}
                        onChange={(next) => setTask(index, next)}
                      />
                    ) : task.type === "container" ? (
                      <Input
                        className="w-full font-mono sm:flex-1"
                        value={task.command.join(" ")}
                        placeholder={t(
                          "servers:schedules.dialog.containerPlaceholder",
                        )}
                        autoComplete="off"
                        onChange={(event) =>
                          setTask(index, {
                            type: "container",
                            command: event.target.value
                              .split(/\s+/)
                              .filter((part) => part.length > 0),
                          })
                        }
                      />
                    ) : (
                      <span className="flex-1 text-xs text-muted-foreground">
                        {t(`servers:schedules.taskHelp.${task.type}`)}
                      </span>
                    )}

                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={tasks.length === 1}
                      aria-label={t("common:actions.remove")}
                      onClick={() =>
                        setTasks((current) =>
                          current.filter(
                            (_entry, position) => position !== index,
                          ),
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                {t("servers:schedules.dialog.tasksHelp")}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditorOpen(false)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={isSubmitting || !canSubmit}
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {t("common:actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("servers:schedules.deleteDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("servers:schedules.deleteDialog.description", {
                name: pendingDelete?.name,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isSubmitting}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              {t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
