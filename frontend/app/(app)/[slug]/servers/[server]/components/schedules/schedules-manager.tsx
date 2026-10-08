"use client";

import useSWR from "swr";
import { useState } from "react";
import {
  CalendarClock,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  type ScheduleTask,
} from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";
import { ScheduleEditorDialog } from "./schedule-editor-dialog";
import {
  LISTED_TASKS,
  type Schedule,
  type ScheduleBody,
  type TaskType,
} from "./utils";

type SchedulesManagerProps = {
  serverId: string;
  canManage: boolean;
  canUseContainerCommands: boolean;
  canCreateBackups: boolean;
  canDeleteBackups: boolean;
  backupLimit: number | null;
  isMinecraftServer: boolean;
};

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

const NO_SCHEDULES: Schedule[] = [];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
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
  const {
    data: schedules = NO_SCHEDULES,
    isValidating: isLoading,
    mutate,
  } = useSWR(
    ["server-schedules", serverId],
    async () => {
      const response = await listSchedules({ path: { server_id: serverId } });

      if (response.error || !response.data) {
        throw new Error(
          apiErrorMessage(
            response.error,
            t("servers:schedules.toasts.loadFailed"),
          ),
        );
      }

      return response.data;
    },
    {
      onError: (error) =>
        toast.error(
          errorMessage(error, t("servers:schedules.toasts.loadFailed")),
        ),
    },
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Schedule | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);

  const isTaskTypeAvailable = (type: TaskType) => {
    if (type === "minecraft") return isMinecraftServer;
    if (type === "container") return canUseContainerCommands;
    if (type === "backup") return canCreateBackups;
    if (type === "prune") return canDeleteBackups;
    return true;
  };

  const formatNextRun = (value: string | null | undefined) => {
    if (!value) return "—";

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "—";

    return parsed.toLocaleString(i18n.language);
  };

  const openEditor = (schedule: Schedule | null) => {
    setEditing(schedule);
    setEditorOpen(true);
  };

  const save = async (body: ScheduleBody) => {
    setIsSubmitting(true);

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
      await mutate();
    } catch (error) {
      toast.error(
        errorMessage(error, t("servers:schedules.toasts.saveFailed")),
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
      toast.error(errorMessage(error, t("servers:schedules.toasts.runFailed")));
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
      await mutate();
    } catch (error) {
      toast.error(
        errorMessage(error, t("servers:schedules.toasts.deleteFailed")),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <CardTitle>{t("servers:schedules.title")}</CardTitle>
              <CardDescription>
                {t("servers:schedules.description")}
              </CardDescription>
            </div>
            {canManage ? (
              <Button
                type="button"
                onClick={() => openEditor(null)}
                disabled={isLoading}
              >
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
                              onClick={() => openEditor(schedule)}
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

      <ScheduleEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        schedule={editing}
        busy={isSubmitting}
        options={{
          isAvailable: isTaskTypeAvailable,
          backupLimit,
          canDeleteBackups,
        }}
        onSave={(body) => void save(body)}
      />
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
              onClick={() => void remove()}
            >
              {t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
