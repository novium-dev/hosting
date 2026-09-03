import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Boxes, CheckCircle2, Loader2, TriangleAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useModpackJob } from "@/hooks/use-modpack-job";
import { cn } from "@/lib/utils";

type ModpackInstallBannerProps = {
  serverId: string;
  enabled?: boolean;
};

const FAILURES_SHOWN = 4;

export function ModpackInstallBanner({
  serverId,
  enabled = true,
}: ModpackInstallBannerProps) {
  const { t } = useTranslation();
  const { job, recent } = useModpackJob(serverId, enabled);
  const [dismissed, setDismissed] = useState<number | null>(null);

  if (!job || !recent || dismissed === job.started_at) {
    return null;
  }

  const running = job.state === "running";
  const failed = job.state === "failed";
  const percent =
    job.total > 0 ? Math.round((job.done / job.total) * 100) : null;
  const pack =
    job.pack ?? t("servers-management:modpackInstall.fallbackPackName");

  return (
    <section
      className={cn(
        "rounded-lg border bg-card p-4 shadow-sm",
        running && "border-primary/40",
        failed && "border-destructive/40 bg-destructive/5",
      )}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md",
            running && "bg-primary/10 text-primary",
            failed && "bg-destructive/10 text-destructive",
            !running &&
              !failed &&
              "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          )}
        >
          {running ? (
            <Loader2 className="size-5 animate-spin" />
          ) : failed ? (
            <TriangleAlert className="size-5" />
          ) : (
            <CheckCircle2 className="size-5" />
          )}
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {running
                ? t("servers-management:modpackInstall.runningTitle", { pack })
                : failed
                  ? t("servers-management:modpackInstall.failedTitle", { pack })
                  : t("servers-management:modpackInstall.doneTitle", { pack })}
            </span>
            {running ? (
              <span className="text-sm text-muted-foreground">{job.step}</span>
            ) : null}
          </span>

          <p className="text-sm text-muted-foreground">
            {running
              ? job.total > 0
                ? t("servers-management:modpackInstall.runningFiles", {
                    done: job.done,
                    total: job.total,
                  })
                : t("servers-management:modpackInstall.runningPreparing")
              : failed
                ? (job.error ??
                  t("servers-management:modpackInstall.failedDefault"))
                : t("servers-management:modpackInstall.doneFiles", {
                    count: job.done,
                  })}
          </p>

          {running ? (
            <Progress
              value={percent ?? undefined}
              className={cn("mt-2 h-2", percent === null && "animate-pulse")}
            />
          ) : null}

          {running ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Boxes className="size-3.5 shrink-0" />
              {t("servers-management:modpackInstall.filesLocked")}
            </p>
          ) : null}

          {!running && job.failures.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("servers-management:modpackInstall.failures", {
                count: job.failures.length,
                list:
                  job.failures.slice(0, FAILURES_SHOWN).join(", ") +
                  (job.failures.length > FAILURES_SHOWN ? ", …" : ""),
              })}
            </p>
          ) : null}
        </div>

        {running ? (
          percent === null ? null : (
            <span className="text-sm font-medium tabular-nums">{percent}%</span>
          )
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("common:actions.dismiss")}
            onClick={() => setDismissed(job.started_at)}
          >
            <X />
          </Button>
        )}
      </div>
    </section>
  );
}
