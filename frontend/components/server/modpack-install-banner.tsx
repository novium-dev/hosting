import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Boxes,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useModpackJob } from "@/hooks/use-modpack-job";
import { PACK_LOADER_LABELS } from "@/lib/mod-browser/types";
import { cn } from "@/lib/utils";

type ModpackInstallBannerProps = {
  serverId: string;
  enabled?: boolean;
};

const PATHS_SHOWN = 4;

function shortList(entries: string[]) {
  return (
    entries.slice(0, PATHS_SHOWN).join(", ") +
    (entries.length > PATHS_SHOWN ? ", …" : "")
  );
}

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
  const fetching = running && job.step === "fetching" && job.total > 0;
  const percent = fetching ? Math.round((job.done / job.total) * 100) : null;
  const pack =
    job.pack ?? t("servers-management:modpackInstall.fallbackPackName");
  const platform = job.platform;

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
              <span className="text-sm text-muted-foreground">
                {t(`servers-management:modpackInstall.steps.${job.step}`)}
              </span>
            ) : null}
          </span>

          <p className="text-sm text-muted-foreground">
            {running
              ? fetching
                ? t("servers-management:modpackInstall.runningFiles", {
                    done: job.done,
                    total: job.total,
                  })
                : t("servers-management:modpackInstall.runningPreparing")
              : failed
                ? (job.error ??
                  t("servers-management:modpackInstall.failedDefault"))
                : t("servers-management:modpackInstall.doneFiles", {
                    count: job.total,
                  })}
          </p>

          {failed && job.live_untouched ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <ShieldCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              {t("servers-management:modpackInstall.untouched")}
            </p>
          ) : null}

          {platform?.loader && platform.game_version ? (
            <p className="text-sm text-muted-foreground">
              {t("servers-management:modpackInstall.platform", {
                loader: PACK_LOADER_LABELS[platform.loader],
                loaderVersion: platform.loader_version ?? "",
                gameVersion: platform.game_version,
              })}
            </p>
          ) : null}

          {running ? (
            <Progress
              value={percent}
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
                list: shortList(job.failures),
              })}
            </p>
          ) : null}

          {!running && job.skipped.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("servers-management:modpackInstall.skipped", {
                count: job.skipped.length,
                list: shortList(job.skipped),
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
