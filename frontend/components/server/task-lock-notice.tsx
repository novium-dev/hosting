import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  taskLabel,
  taskProgressPercent,
  type TaskLock,
} from "@/lib/server-tasks";

type TaskLockNoticeProps = {
  lock: TaskLock;
  className?: string;
};

export function TaskLockNotice({ lock, className }: TaskLockNoticeProps) {
  const { t } = useTranslation();

  if (!lock.locked || !lock.blocking) {
    return null;
  }

  const percent = taskProgressPercent(lock.blocking);

  return (
    <p
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <Loader2 className="size-3.5 animate-spin" />
      {t("servers:tasks.blocked", { task: taskLabel(lock.blocking, t) })}
      {percent === null ? null : ` (${percent.toFixed(0)}%)`}
    </p>
  );
}
