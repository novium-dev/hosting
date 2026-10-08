import { Archive } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { BackupRetention } from "@/lib/api";
import {
  DEFAULT_RETENTION,
  EMPTY_RETENTION,
  RETENTION_FIELDS,
  retentionCeiling,
  retentionOf,
  type RetentionTask,
} from "./utils";

export function RetentionTaskField({
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
