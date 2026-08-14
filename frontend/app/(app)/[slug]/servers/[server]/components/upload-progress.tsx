"use client";

import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export type UploadTask = {
  id: string;
  name: string;
  loaded: number;
  total: number;
  status: "pending" | "uploading" | "done" | "error";
};

function taskPercent(task: UploadTask) {
  if (task.status === "done") {
    return 100;
  }

  if (task.status === "pending" || task.total <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((task.loaded / task.total) * 100));
}

export default function UploadProgressPanel({
  tasks,
  onDismiss,
}: Readonly<{ tasks: UploadTask[]; onDismiss: () => void }>) {
  const { t } = useTranslation();

  if (tasks.length === 0) {
    return null;
  }

  const finished = tasks.filter(
    (task) => task.status === "done" || task.status === "error",
  ).length;
  const isRunning = finished < tasks.length;
  const hasErrors = tasks.some((task) => task.status === "error");

  const totalBytes = tasks.reduce(
    (sum, task) => sum + Math.max(task.total, 0),
    0,
  );
  const loadedBytes = tasks.reduce(
    (sum, task) => sum + (task.status === "done" ? task.total : task.loaded),
    0,
  );
  const overallPercent =
    totalBytes > 0
      ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100))
      : Math.round((finished / tasks.length) * 100);

  const title = isRunning
    ? t("servers-management:filesManager.uploadProgress.uploading", {
        done: finished,
        total: tasks.length,
      })
    : hasErrors
      ? t("servers-management:filesManager.uploadProgress.completeWithErrors")
      : t("servers-management:filesManager.uploadProgress.complete");

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-card p-3 shadow-lg">
      <div className="flex items-center gap-2">
        {isRunning ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : hasErrors ? (
          <AlertCircle className="size-4 shrink-0 text-destructive" />
        ) : (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={t("common:actions.close")}
          onClick={onDismiss}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <Progress value={overallPercent} className="mt-2" />

      <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
        {tasks.map((task) => (
          <div key={task.id} className="space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{task.name}</span>
              <span className="shrink-0 text-muted-foreground">
                {task.status === "error"
                  ? t(
                      "servers-management:filesManager.uploadProgress.statusFailed",
                    )
                  : task.status === "pending"
                    ? t(
                        "servers-management:filesManager.uploadProgress.statusPending",
                      )
                    : `${taskPercent(task)}%`}
              </span>
            </div>
            <Progress
              value={taskPercent(task)}
              className={`h-1 ${task.status === "error" ? "opacity-40" : ""}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
