"use client";

import type { DragEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
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

type SchedulesManagerProps = {
  serverId: string;
  canManage: boolean;
  isMinecraftServer: boolean;
};

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
];

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

function emptyTask(type: TaskType): ScheduleTask {
  switch (type) {
    case "sleep":
      return { type, time: 60 };
    case "terminal":
    case "minecraft":
      return { type, command: "" };
    case "container":
      return { type, command: [] };
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

  return true;
}

function errorMessage(
  error: { error?: { msg?: string } } | undefined,
  fallback: string,
) {
  return error?.error?.msg ?? fallback;
}

export function SchedulesManager({
  serverId,
  canManage,
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
  const taskTypes = useMemo(
    () =>
      TASK_TYPES.filter((type) => type !== "minecraft" || isMinecraftServer),
    [isMinecraftServer],
  );

  const refresh = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await listSchedules({ path: { server_id: serverId } });

      if (response.error || !response.data) {
        throw new Error(
          errorMessage(response.error, t("servers:schedules.toasts.loadFailed")),
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
    setTasks(schedule.tasks.length > 0 ? schedule.tasks : [{ type: "restart" }]);
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
  const tasksValid = tasks.length > 0 && tasks.every(taskIsComplete);
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
          errorMessage(
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
          errorMessage(response.error, t("servers:schedules.toasts.runFailed")),
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
          errorMessage(
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
                        {schedule.tasks
                          .map((task) =>
                            t(`servers:schedules.taskTypes.${task.type}`),
                          )
                          .join(" → ")}
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
                                minute: clamp(Number(event.target.value), 0, 59),
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
                <Select value={timezone} onValueChange={setTimezone}>
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
                  value={policy}
                  onValueChange={(value) =>
                    setPolicy(value as SchedulePolicy)
                  }
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
                      value={task.type}
                      onValueChange={(value) =>
                        setTask(index, emptyTask(value as TaskType))
                      }
                    >
                      <SelectTrigger className="w-full sm:w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {taskTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {t(`servers:schedules.taskTypes.${type}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {task.type === "sleep" ? (
                      <Input
                        type="number"
                        min={1}
                        className="w-full sm:flex-1"
                        value={task.time}
                        aria-label={t("servers:schedules.dialog.sleepSeconds")}
                        onChange={(event) =>
                          setTask(index, {
                            type: "sleep",
                            time: Math.max(1, Number(event.target.value) || 1),
                          })
                        }
                      />
                    ) : task.type === "terminal" || task.type === "minecraft" ? (
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
