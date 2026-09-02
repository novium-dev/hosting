"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Loader2,
  Pencil,
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
  updateSchedule,
  SchedulePolicy,
  type ListSchedulesResponse,
  type ScheduleTask,
} from "@/lib/api";

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

const CRON_FIELDS = [
  "second",
  "minute",
  "hour",
  "dayOfMonth",
  "month",
  "dayOfWeek",
] as const;

const DEFAULT_CRON = ["0", "0", "4", "*", "*", "*"];

const CRON_PRESETS: { key: string; fields: string[] }[] = [
  { key: "hourly", fields: ["0", "0", "*", "*", "*", "*"] },
  { key: "daily", fields: ["0", "0", "4", "*", "*", "*"] },
  { key: "weekly", fields: ["0", "0", "4", "*", "*", "SUN"] },
  { key: "monthly", fields: ["0", "0", "4", "1", "*", "*"] },
];

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

/**
 * Splits a stored expression into the six fields the form edits. The backend
 * stores six-field expressions, but a five-field one is read as starting at the
 * minute, matching how the backend normalises it.
 */
function splitCron(expression: string) {
  const fields = expression.trim().split(/\s+/);
  const padded = fields.length === 5 ? ["0", ...fields] : fields;

  return CRON_FIELDS.map((_field, index) => padded[index] ?? "*");
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

  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [policy, setPolicy] = useState<SchedulePolicy>(SchedulePolicy.ALWAYS);
  const [cron, setCron] = useState<string[]>(DEFAULT_CRON);
  const [timezone, setTimezone] = useState(localTimezone());
  const [tasks, setTasks] = useState<ScheduleTask[]>([{ type: "restart" }]);

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
    setTimezone(localTimezone());
    setTasks([{ type: "restart" }]);
    setEditorOpen(true);
  };

  const openEdit = (schedule: Schedule) => {
    setEditing(schedule);
    setName(schedule.name);
    setEnabled(schedule.enabled);
    setPolicy(schedule.policy);
    setCron(splitCron(schedule.cron));
    setTimezone(schedule.timezone);
    setTasks(schedule.tasks.length > 0 ? schedule.tasks : [{ type: "restart" }]);
    setEditorOpen(true);
  };

  const setCronField = (index: number, value: string) => {
    setCron((current) =>
      current.map((field, position) => (position === index ? value : field)),
    );
  };

  const setTask = (index: number, task: ScheduleTask) => {
    setTasks((current) =>
      current.map((entry, position) => (position === index ? task : entry)),
    );
  };

  const moveTask = (index: number, offset: number) => {
    setTasks((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;

      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);

      return next;
    });
  };

  const nameValid = name.trim().length > 0 && name.trim().length <= 64;
  const cronValid = cron.every((field) => field.trim().length > 0);
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
              <div className="flex items-center justify-between gap-3">
                <Label>{t("servers:schedules.dialog.cronLabel")}</Label>
                <Select
                  value=""
                  onValueChange={(value) => {
                    const preset = CRON_PRESETS.find(
                      (entry) => entry.key === value,
                    );
                    if (preset) setCron(preset.fields);
                  }}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue
                      placeholder={t("servers:schedules.dialog.presets")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {CRON_PRESETS.map((preset) => (
                      <SelectItem key={preset.key} value={preset.key}>
                        {t(`servers:schedules.presets.${preset.key}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                {CRON_FIELDS.map((field, index) => (
                  <div key={field} className="space-y-1">
                    <Label
                      htmlFor={`schedule-cron-${field}`}
                      className="text-xs text-muted-foreground"
                    >
                      {t(`servers:schedules.cronFields.${field}`)}
                    </Label>
                    <Input
                      id={`schedule-cron-${field}`}
                      className="font-mono"
                      value={cron[index] ?? "*"}
                      autoComplete="off"
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
                    className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center"
                  >
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

                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={index === 0}
                        aria-label={t("servers:schedules.dialog.moveUp")}
                        onClick={() => moveTask(index, -1)}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={index === tasks.length - 1}
                        aria-label={t("servers:schedules.dialog.moveDown")}
                        onClick={() => moveTask(index, 1)}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
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
